import { useSyncExternalStore } from 'react';
import { addActivity } from './activityStore';
import { getCurrentUserId } from './authStore';
import { generateId } from '@/utils/id';
import { formatMoneyCents } from '@/utils/money';
import { computeDueDate, isSameMonthAsDate, isSameYearAsDate } from '@/utils/date';
import { supabase } from '@/lib/supabase';
import { writeInvoiceRows, type InvoiceDbClient } from './invoicePersistence';
import {
  calculateInvoiceBalance,
  calculateInvoicePaymentTotal,
  isInvoiceWaitingToBePaid,
} from '@/utils/invoiceMath';

// Re-exported so every existing import from this module keeps working.
export {
  calculateInvoiceBalance,
  calculateInvoicePaymentTotal,
  isInvoiceWaitingToBePaid,
};

export type InvoiceStatus = 'Draft' | 'Sent' | 'Due Today' | 'Overdue' | 'Paid';

export type Invoice = {
  id: string;
  invoice: string;
  customer: string;
  customerId?: string;
  // Cents, like every other money value in the app (see src/utils/money.ts).
  amount: number;
  status: InvoiceStatus;
  invoiceDate: string;
  terms?: string;
  poNumber?: string;
  bolNumber?: string;
  shipper?: string;
  consignee?: string;
  freightDescription?: string;
  lineItems?: InvoiceLineItem[];
  payments?: InvoicePayment[];
  attachments?: InvoiceAttachment[];
};

export type InvoiceLineItem = {
  id: string;
  description: string;
  // Cents, like every other money value in the app (see src/utils/money.ts).
  amount: number;
};

export type InvoicePayment = {
  id: string;
  // Cents, like every other money value in the app (see src/utils/money.ts).
  amount: number;
  date: string;
  notes?: string;
};

export type InvoiceAttachment = {
  id: string;
  name: string;
  type: string;
  dateAdded: string;
  size?: number;
  // In-tab-only preview (URL.createObjectURL) - gone after refresh/new tab.
  objectUrl?: string;
  // Path in the `receipts` Supabase Storage bucket (shared with expense
  // receipts - same private, owner-scoped bucket) - durable across
  // refreshes/devices.
  storagePath?: string;
};

export type InvoiceAttachmentInput = {
  name: string;
  type: string;
  size?: number;
  objectUrl?: string;
  storagePath?: string;
};

export type ReceiveInvoicePaymentInput = {
  // Cents, like every other money value in the app (see src/utils/money.ts).
  amount: number;
  date: string;
  notes?: string;
  // The real bank account the money was deposited to ("Deposited to"). Required: never guessed.
  depositAccountId: string;
};

export const invoiceStatuses: InvoiceStatus[] = ['Draft', 'Sent', 'Due Today', 'Paid', 'Overdue'];

export const invoiceLabels = {
  description: 'Freight Description',
  shipper: 'Shipper Address',
  consignee: 'Consignee Address',
  bol: 'BOL Number',
  po: 'PO Number',
};

// Blank-form defaults for a brand-new invoice - deliberately empty/generic,
// not sample data. This used to be seeded with a fake customer name and PO/
// BOL numbers ("Independent Steel", "PO-44321", etc.) left over from local
// development, which a real new user would see pre-filled on their very
// first invoice as if it meant something.
export const invoiceDraft = {
  terms: 'Net 30',
  customer: '',
  poNumber: '',
  bolNumber: '',
  shipper: '',
  consignee: '',
  freightDescription: '',
};

export const invoiceLineItems: InvoiceLineItem[] = [];

type InvoiceRow = {
  id: string;
  invoice_number: string;
  customer: string;
  customer_id: string | null;
  amount: number;
  status: InvoiceStatus;
  invoice_date: string | null;
  terms: string | null;
  po_number: string | null;
  bol_number: string | null;
  shipper: string | null;
  consignee: string | null;
  freight_description: string | null;
  invoice_line_items: LineItemRow[] | null;
  invoice_attachments: AttachmentRow[] | null;
};

type LineItemRow = { id: string; description: string; amount: number; position: number };
type PaymentApplicationRow = { invoice_id: string; amount_cents: number; payment_id: string };
type PaymentRow = { id: string; payment_date: string | null; notes: string | null; voided_at: string | null };
type AttachmentRow = {
  id: string;
  name: string;
  type: string;
  date_added: string;
  size: number | null;
  storage_path: string | null;
};

function rowToInvoice(row: InvoiceRow, payments: InvoicePayment[]): Invoice {
  return {
    id: row.id,
    invoice: row.invoice_number,
    customer: row.customer,
    customerId: row.customer_id ?? undefined,
    amount: row.amount,
    status: row.status,
    invoiceDate: row.invoice_date ?? '',
    terms: row.terms ?? undefined,
    poNumber: row.po_number ?? undefined,
    bolNumber: row.bol_number ?? undefined,
    shipper: row.shipper ?? undefined,
    consignee: row.consignee ?? undefined,
    freightDescription: row.freight_description ?? undefined,
    lineItems: (row.invoice_line_items ?? [])
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((item) => ({ id: item.id, description: item.description, amount: item.amount })),
    payments,
    attachments: (row.invoice_attachments ?? []).map((attachment) => ({
      id: attachment.id,
      name: attachment.name,
      type: attachment.type,
      dateAdded: attachment.date_added,
      size: attachment.size ?? undefined,
      storagePath: attachment.storage_path ?? undefined,
    })),
  };
}

let invoicesSnapshot: Invoice[] = [];
const listeners = new Set<() => void>();

function emitChange() {
  listeners.forEach((listener) => listener());
}

export async function loadInvoices(userId: string) {
  const { data, error } = await supabase
    .from('invoices')
    .select('*, invoice_line_items(*), invoice_attachments(*)')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .order('position', { foreignTable: 'invoice_line_items', ascending: true })
    .order('date_added', { foreignTable: 'invoice_attachments', ascending: true });

  if (error) {
    console.error('Failed to load invoices', error);
    return;
  }

  // What has been paid on each invoice comes from the books' payment
  // applications (money actually received and applied), never from a number
  // typed onto the invoice. Voided payments are ignored.
  const [applicationsResult, paymentsResult] = await Promise.all([
    supabase.from('payment_applications').select('invoice_id, amount_cents, payment_id').eq('user_id', userId),
    supabase.from('payments').select('id, payment_date, notes, voided_at').eq('user_id', userId),
  ]);
  if (applicationsResult.error || paymentsResult.error) {
    console.error('Failed to load payments', applicationsResult.error ?? paymentsResult.error);
    return;
  }

  const paymentById = new Map<string, PaymentRow>(
    ((paymentsResult.data ?? []) as PaymentRow[]).map((payment) => [payment.id, payment])
  );
  const paymentsByInvoice = new Map<string, InvoicePayment[]>();
  for (const application of (applicationsResult.data ?? []) as PaymentApplicationRow[]) {
    const payment = paymentById.get(application.payment_id);
    if (!payment || payment.voided_at) continue;
    const list = paymentsByInvoice.get(application.invoice_id) ?? [];
    list.push({
      id: `${application.payment_id}:${application.invoice_id}`,
      amount: Number(application.amount_cents),
      date: payment.payment_date ?? '',
      notes: payment.notes ?? undefined,
    });
    paymentsByInvoice.set(application.invoice_id, list);
  }

  invoicesSnapshot = ((data ?? []) as InvoiceRow[]).map((row) => rowToInvoice(row, paymentsByInvoice.get(row.id) ?? []));
  refreshInvoiceStatuses();
  emitChange();
}

export function clearInvoices() {
  invoicesSnapshot = [];
  emitChange();
}

// The database only stores whether an invoice is a Draft or has been sent.
// Everything else the customer sees (Paid, Due Today, Overdue) is derived here
// from what has actually been paid and the due date.
function refreshInvoiceStatuses() {
  const now = new Date();
  invoicesSnapshot = invoicesSnapshot.map((inv) => {
    if (inv.status === 'Draft') return inv;

    if (inv.amount > 0 && calculateInvoiceBalance(inv) <= 0) return { ...inv, status: 'Paid' };

    const due = computeDueDate(inv.invoiceDate, inv.terms);
    if (!due) return { ...inv, status: 'Sent' };

    const dueDateOnly = new Date(due.getFullYear(), due.getMonth(), due.getDate());
    const todayOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    if (dueDateOnly.getTime() === todayOnly.getTime()) {
      return { ...inv, status: 'Due Today' };
    }

    if (dueDateOnly.getTime() < todayOnly.getTime()) {
      return { ...inv, status: 'Overdue' };
    }

    return { ...inv, status: 'Sent' };
  });
}

// Kept under its original name so the ~20 existing call sites across the app
// don't all need touching - it formats cents, like every other money value.
// See src/utils/money.ts for the single canonical implementation.
export const formatInvoiceAmount = formatMoneyCents;

// Kept under their original names for the same reason as formatInvoiceAmount
// above - both delegate to the shared implementation in src/utils/date.ts.
export const isSameMonth = isSameMonthAsDate;
export const isSameYear = isSameYearAsDate;

export async function saveInvoice(invoice: Invoice, originalInvoiceId?: string) {
  const userId = getCurrentUserId();
  if (!userId) {
    throw new Error('You must be signed in to save an invoice.');
  }

  const lookupInvoiceId = originalInvoiceId ?? invoice.id;
  const existingInvoiceIndex = invoicesSnapshot.findIndex((item) => item.id === lookupInvoiceId);
  const existingInvoice = existingInvoiceIndex >= 0 ? invoicesSnapshot[existingInvoiceIndex] : undefined;

  const lineItems = invoice.lineItems ?? [];
  try {
    // Only Draft / Sent are stored; Paid, Due Today and Overdue are derived (see refreshInvoiceStatuses).
    await writeInvoiceRows(supabase as unknown as InvoiceDbClient, userId, {
      ...invoice,
      status: invoice.status === 'Draft' ? 'Draft' : 'Sent',
    });
  } catch (error) {
    console.error('Failed to save invoice', error);
    throw error;
  }

  const invoiceToSave: Invoice = {
    ...invoice,
    lineItems,
    attachments: invoice.attachments ?? existingInvoice?.attachments,
    payments: invoice.payments ?? existingInvoice?.payments,
  };

  if (existingInvoiceIndex >= 0) {
    invoicesSnapshot = invoicesSnapshot.map((item, index) => (index === existingInvoiceIndex ? invoiceToSave : item));
    addActivity(`Invoice #${invoice.invoice} updated`);
  } else {
    invoicesSnapshot = [invoiceToSave, ...invoicesSnapshot];
    addActivity(`Invoice #${invoice.invoice} created`);
  }

  refreshInvoiceStatuses();
  emitChange();
}

// Uploads the actual file bytes to the (shared, private) `receipts` Storage
// bucket, namespaced under invoices/{invoiceId} so it doesn't collide with
// expense receipt paths - both share the same bucket and RLS policies
// (first path segment must match the signed-in user's own id).
export async function uploadInvoiceAttachmentFile(userId: string, invoiceId: string, file: File): Promise<string> {
  const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]+/g, '_');
  const path = `${userId}/invoices/${invoiceId}/${Date.now()}-${safeName}`;

  const { error } = await supabase.storage.from('receipts').upload(path, file, {
    contentType: file.type || 'application/octet-stream',
    upsert: false,
  });

  if (error) {
    console.error('Failed to upload invoice attachment file', error);
    throw error;
  }

  return path;
}

async function removeAttachmentFile(storagePath?: string) {
  if (!storagePath) return;
  const { error } = await supabase.storage.from('receipts').remove([storagePath]);
  if (error) {
    console.error('Failed to delete attachment file from storage', error);
  }
}

// Resolves a viewable URL for an attachment: the in-tab blob if this is the
// same session it was uploaded in, otherwise a short-lived signed URL from
// Storage. Returns undefined if neither is available.
export async function getInvoiceAttachmentViewUrl(attachment: InvoiceAttachment): Promise<string | undefined> {
  if (attachment.objectUrl) {
    return attachment.objectUrl;
  }
  if (!attachment.storagePath) {
    return undefined;
  }

  const { data, error } = await supabase.storage.from('receipts').createSignedUrl(attachment.storagePath, 60);
  if (error || !data) {
    console.error('Failed to create signed attachment URL', error);
    return undefined;
  }
  return data.signedUrl;
}

export async function addInvoiceAttachment(invoiceId: string, attachmentInput?: InvoiceAttachmentInput) {
  const userId = getCurrentUserId();
  if (!userId) {
    throw new Error('You must be signed in to attach a file.');
  }

  const invoice = invoicesSnapshot.find((item) => item.id === invoiceId);
  if (!invoice) {
    return;
  }

  const attachmentCount = (invoice.attachments ?? []).length + 1;
  const attachment: InvoiceAttachment = {
    id: generateId(),
    name: attachmentInput?.name || `invoice-${invoice.invoice}-paperwork-${attachmentCount}.pdf`,
    type: attachmentInput?.type || 'application/pdf',
    dateAdded: new Date().toISOString(),
    size: attachmentInput?.size,
    objectUrl: attachmentInput?.objectUrl,
    storagePath: attachmentInput?.storagePath,
  };

  const { error } = await supabase.from('invoice_attachments').insert({
    id: attachment.id,
    invoice_id: invoiceId,
    user_id: userId,
    name: attachment.name,
    type: attachment.type,
    date_added: attachment.dateAdded,
    size: attachment.size ?? null,
    storage_path: attachment.storagePath ?? null,
  });

  if (error) {
    console.error('Failed to save attachment', error);
    throw error;
  }

  invoicesSnapshot = invoicesSnapshot.map((item) =>
    item.id === invoiceId ? { ...item, attachments: [...(item.attachments ?? []), attachment] } : item
  );

  addActivity(`Attachment added to invoice #${invoice.invoice}: ${attachment.name}`);
  emitChange();
}

export async function reattachInvoiceAttachment(
  invoiceId: string,
  attachmentId: string,
  attachmentInput: InvoiceAttachmentInput
) {
  const invoice = invoicesSnapshot.find((item) => item.id === invoiceId);
  const attachment = invoice?.attachments?.find((item) => item.id === attachmentId);

  if (!invoice || !attachment) {
    return;
  }

  if (typeof URL !== 'undefined' && attachment.objectUrl?.startsWith('blob:')) {
    URL.revokeObjectURL(attachment.objectUrl);
  }
  const previousStoragePath = attachment.storagePath;

  const { error } = await supabase
    .from('invoice_attachments')
    .update({
      name: attachmentInput.name,
      type: attachmentInput.type,
      size: attachmentInput.size ?? null,
      storage_path: attachmentInput.storagePath ?? null,
    })
    .eq('id', attachmentId);

  if (error) {
    console.error('Failed to reattach attachment', error);
    throw error;
  }
  if (previousStoragePath && previousStoragePath !== attachmentInput.storagePath) {
    await removeAttachmentFile(previousStoragePath);
  }

  invoicesSnapshot = invoicesSnapshot.map((item) =>
    item.id === invoiceId
      ? {
          ...item,
          attachments: (item.attachments ?? []).map((file) =>
            file.id === attachmentId
              ? {
                  ...file,
                  name: attachmentInput.name,
                  type: attachmentInput.type,
                  size: attachmentInput.size,
                  objectUrl: attachmentInput.objectUrl,
                  storagePath: attachmentInput.storagePath,
                }
              : file
          ),
        }
      : item
  );

  addActivity(`Attachment reattached to invoice #${invoice.invoice}: ${attachmentInput.name}`);
  emitChange();
}

export async function deleteInvoiceAttachment(invoiceId: string, attachmentId: string) {
  const invoice = invoicesSnapshot.find((item) => item.id === invoiceId);
  const attachment = invoice?.attachments?.find((item) => item.id === attachmentId);

  if (!invoice || !attachment) {
    return;
  }

  if (typeof URL !== 'undefined' && attachment.objectUrl?.startsWith('blob:')) {
    URL.revokeObjectURL(attachment.objectUrl);
  }

  const { error } = await supabase.from('invoice_attachments').delete().eq('id', attachmentId);
  if (error) {
    console.error('Failed to delete attachment', error);
    throw error;
  }
  await removeAttachmentFile(attachment.storagePath);

  invoicesSnapshot = invoicesSnapshot.map((item) =>
    item.id === invoiceId
      ? { ...item, attachments: (item.attachments ?? []).filter((file) => file.id !== attachmentId) }
      : item
  );

  addActivity(`Attachment deleted from invoice #${invoice.invoice}: ${attachment.name}`);
  emitChange();
}

// Draft <-> Sent only. An invoice becomes Paid by recording a payment (with the
// account it was deposited to), never by flipping a status - see recordInvoicePayment.
export async function updateInvoiceStatus(invoiceId: string, status: 'Draft' | 'Sent') {
  const invoice = invoicesSnapshot.find((item) => item.id === invoiceId);

  if (!invoice) {
    return;
  }

  const { error } = await supabase.rpc('set_invoice_status', { p_invoice_id: invoiceId, p_status: status });
  if (error) {
    console.error('Failed to update invoice status', error);
    throw error;
  }

  invoicesSnapshot = invoicesSnapshot.map((item) => (item.id === invoiceId ? { ...item, status } : item));
  addActivity(`Invoice #${invoice.invoice} marked ${status}`);
  refreshInvoiceStatuses();
  emitChange();
}

// Records money received against one invoice and deposits it to a real bank
// account, in ONE database transaction (record_payment). Never more than is owed.
export async function receiveInvoicePayment(invoiceId: string, paymentInput: ReceiveInvoicePaymentInput) {
  const userId = getCurrentUserId();
  if (!userId) {
    throw new Error('You must be signed in to record a payment.');
  }
  if (!paymentInput.depositAccountId) {
    throw new Error('Choose the account this was deposited to.');
  }

  const invoice = invoicesSnapshot.find((item) => item.id === invoiceId);
  if (!invoice) {
    return;
  }

  const currentBalance = calculateInvoiceBalance(invoice);
  const receivedAmount = Math.min(Math.max(paymentInput.amount, 0), currentBalance);

  if (receivedAmount <= 0) {
    return;
  }

  const { error } = await supabase.rpc('record_payment', {
    p_customer_id: invoice.customerId ?? null,
    p_payment_date: paymentInput.date.slice(0, 10),
    p_amount_cents: receivedAmount,
    p_deposit_account_id: paymentInput.depositAccountId,
    p_applications: [{ invoice_id: invoiceId, amount_cents: receivedAmount }],
    p_method: null,
    p_reference: null,
    p_notes: paymentInput.notes?.trim() || null,
  });

  if (error) {
    console.error('Failed to save payment', error);
    throw error;
  }

  addActivity(`Payment received: ${formatInvoiceAmount(receivedAmount)} from ${invoice.customer} for invoice #${invoice.invoice}`);
  await loadInvoices(userId);
}

export function useInvoices() {
  // Recomputed on every call (not just on load) so a "Sent" invoice that
  // crosses its due date while the tab is left open updates to "Due
  // Today"/"Overdue" without needing a full page reload - same behavior
  // as before this store talked to Supabase.
  refreshInvoiceStatuses();
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => invoicesSnapshot,
    () => invoicesSnapshot
  );
}
