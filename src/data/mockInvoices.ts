import { useSyncExternalStore } from 'react';
import { addActivity } from './activityStore';
import { loadPersistedData, persistData } from './persistentStore';
import { generateId } from '@/utils/id';
import { dollarsToCents, formatMoneyCents, parseMoneyInputToCents } from '@/utils/money';
import { computeDueDate, isSameMonthAsDate, isSameYearAsDate, normalizeDateToISO } from '@/utils/date';

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
  objectUrl?: string;
};

export type InvoiceAttachmentInput = {
  name: string;
  type: string;
  size?: number;
  objectUrl?: string;
};

export type ReceiveInvoicePaymentInput = {
  // Cents, like every other money value in the app (see src/utils/money.ts).
  amount: number;
  date: string;
  notes?: string;
};

export const invoiceStatuses: InvoiceStatus[] = ['Draft', 'Sent', 'Due Today', 'Paid', 'Overdue'];

export const invoiceLabels = {
  description: 'Freight Description',
  shipper: 'Shipper Address',
  consignee: 'Consignee Address',
  bol: 'BOL Number',
  po: 'PO Number',
};

export const invoiceDraft = {
  number: '26032',
  date: '06/09/2026',
  terms: 'Net 30',
  customer: 'Independent Steel',
  poNumber: 'PO-44321',
  bolNumber: 'BOL-99812',
  shipper: 'Address',
  consignee: 'Address',
  freightDescription: 'Steel Beams',
  total: '$625',
};

export const invoiceLineItems: InvoiceLineItem[] = [{ description: 'Flatbed Freight', amount: 62500 }];

const initialInvoices: Invoice[] = [
  {
    id: 'seed-invoice-26031',
    invoice: '26031',
    customer: 'Independent Steel',
    amount: 62500,
    status: 'Sent',
    invoiceDate: 'Apr 1, 2026',
  },
  {
    id: 'seed-invoice-26028',
    invoice: '26028',
    customer: 'Louisville Dryer',
    amount: 85000,
    status: 'Overdue',
    invoiceDate: 'Mar 18, 2026',
  },
  {
    id: 'seed-invoice-26027',
    invoice: '26027',
    customer: 'ABC Steel',
    amount: 27500,
    status: 'Paid',
    invoiceDate: 'Apr 10, 2026',
  },
];

const LOCAL_STORAGE_KEY = 'bluecollarbooks_invoices';

// Backfills a stable id for any invoice saved before ids existed, so
// by-id lookups below don't silently fail to find pre-existing invoices.
function migrateInvoice(invoice: Invoice): Invoice {
  return invoice.id ? invoice : { ...invoice, id: generateId() };
}

// One-time flag so existing local invoices (amount/line-item amounts stored
// as formatted "$625" strings, payments stored as whole dollars) get
// converted to cents exactly once. Without this, re-running the conversion
// on every load would corrupt the numbers further each time.
const MONEY_VERSION_KEY = 'bluecollarbooks_invoices_money_v';
const moneyVersion = loadPersistedData<number>(MONEY_VERSION_KEY, 0);

function migrateInvoiceMoney(invoice: Invoice): Invoice {
  if (moneyVersion >= 1) return invoice;

  const rawAmount = invoice.amount as unknown;
  const rawLineItems = invoice.lineItems as unknown as Array<{ description: string; amount: unknown }> | undefined;
  const rawPayments = invoice.payments as unknown as
    | Array<{ id: string; amount: number; date: string; notes?: string }>
    | undefined;

  return {
    ...invoice,
    amount: typeof rawAmount === 'string' ? parseMoneyInputToCents(rawAmount) : (rawAmount as number),
    lineItems: rawLineItems?.map((item) => ({
      description: item.description,
      amount: typeof item.amount === 'string' ? parseMoneyInputToCents(item.amount) : (item.amount as number),
    })),
    payments: rawPayments?.map((payment) => ({ ...payment, amount: dollarsToCents(payment.amount) })),
  };
}

// One-time flag so existing local dates (invoiceDate stored in mixed
// "Apr 1, 2026" / "06/09/2026" formats, payment dates as loose strings) get
// normalized to ISO 'YYYY-MM-DD' exactly once.
const DATE_VERSION_KEY = 'bluecollarbooks_invoices_date_v';
const dateVersion = loadPersistedData<number>(DATE_VERSION_KEY, 0);

function migrateInvoiceDates(invoice: Invoice): Invoice {
  if (dateVersion >= 1) return invoice;
  return {
    ...invoice,
    invoiceDate: normalizeDateToISO(invoice.invoiceDate),
    payments: invoice.payments?.map((payment) => ({ ...payment, date: normalizeDateToISO(payment.date) })),
  };
}

let invoicesSnapshot = loadPersistedData<Invoice[]>(LOCAL_STORAGE_KEY, initialInvoices)
  .map(migrateInvoice)
  .map(migrateInvoiceMoney)
  .map(migrateInvoiceDates)
  .map(sanitizeInvoiceForPersistence);
if (moneyVersion < 1) {
  persistData(MONEY_VERSION_KEY, 1);
}
if (dateVersion < 1) {
  persistData(DATE_VERSION_KEY, 1);
}
const listeners = new Set<() => void>();

function emitChange() {
  listeners.forEach((listener) => listener());
}

function sanitizeInvoiceForPersistence(invoice: Invoice): Invoice {
  return {
    ...invoice,
    attachments: invoice.attachments?.map(({ objectUrl, ...attachment }) => attachment),
  };
}

function persistInvoices() {
  persistData(LOCAL_STORAGE_KEY, invoicesSnapshot.map(sanitizeInvoiceForPersistence));
}

persistInvoices();

function refreshInvoiceStatuses() {
  const now = new Date();
  invoicesSnapshot = invoicesSnapshot.map((inv) => {
    if (inv.status === 'Paid' || inv.status === 'Draft') return inv;

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
// don't all need touching - it now formats cents, like every other money
// value, instead of dollars. See src/utils/money.ts for the single canonical
// implementation.
export const formatInvoiceAmount = formatMoneyCents;

// Kept under their original names for the same reason as formatInvoiceAmount
// above - both now delegate to the single shared implementation in
// src/utils/date.ts instead of the locally-duplicated parser this file used
// to have.
export const isSameMonth = isSameMonthAsDate;
export const isSameYear = isSameYearAsDate;

export function calculateInvoicePaymentTotal(invoice: Invoice) {
  const explicitPaymentTotal = (invoice.payments ?? []).reduce((total, payment) => total + payment.amount, 0);

  if (explicitPaymentTotal > 0) {
    return Math.min(explicitPaymentTotal, invoice.amount);
  }

  return invoice.status === 'Paid' ? invoice.amount : 0;
}

export function calculateInvoiceBalance(invoice: Invoice) {
  return Math.max(invoice.amount - calculateInvoicePaymentTotal(invoice), 0);
}

export function saveInvoice(invoice: Invoice, originalInvoiceId?: string) {
  const lookupInvoiceId = originalInvoiceId ?? invoice.id;
  const existingInvoiceIndex = invoicesSnapshot.findIndex((item) => item.id === lookupInvoiceId);

  if (existingInvoiceIndex >= 0) {
    const existingInvoice = invoicesSnapshot[existingInvoiceIndex];
    const invoiceToSave = {
      ...invoice,
      attachments: invoice.attachments ?? existingInvoice.attachments,
      payments: invoice.payments ?? existingInvoice.payments,
    };

    invoicesSnapshot = invoicesSnapshot.map((item, index) =>
      index === existingInvoiceIndex ? invoiceToSave : item
    );
    addActivity(`Invoice #${invoice.invoice} updated`);
  } else {
    invoicesSnapshot = [invoice, ...invoicesSnapshot];
    addActivity(`Invoice #${invoice.invoice} created`);
  }

  persistInvoices();
  refreshInvoiceStatuses();
  emitChange();
}

export function addInvoiceAttachment(invoiceId: string, attachmentInput?: InvoiceAttachmentInput) {
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
  };

  invoicesSnapshot = invoicesSnapshot.map((item) =>
    item.id === invoiceId
      ? { ...item, attachments: [...(item.attachments ?? []), attachment] }
      : item
  );

  persistInvoices();
  addActivity(`Attachment added to invoice #${invoice.invoice}: ${attachment.name}`);
  emitChange();
}

export function reattachInvoiceAttachment(
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
                }
              : file
          ),
        }
      : item
  );

  persistInvoices();
  addActivity(`Attachment reattached to invoice #${invoice.invoice}: ${attachmentInput.name}`);
  emitChange();
}

export function deleteInvoiceAttachment(invoiceId: string, attachmentId: string) {
  const invoice = invoicesSnapshot.find((item) => item.id === invoiceId);
  const attachment = invoice?.attachments?.find((item) => item.id === attachmentId);

  if (!invoice || !attachment) {
    return;
  }

  if (typeof URL !== 'undefined' && attachment.objectUrl?.startsWith('blob:')) {
    URL.revokeObjectURL(attachment.objectUrl);
  }

  invoicesSnapshot = invoicesSnapshot.map((item) =>
    item.id === invoiceId
      ? { ...item, attachments: (item.attachments ?? []).filter((file) => file.id !== attachmentId) }
      : item
  );

  persistInvoices();
  addActivity(`Attachment deleted from invoice #${invoice.invoice}: ${attachment.name}`);
  emitChange();
}

export function updateInvoiceStatus(invoiceId: string, status: InvoiceStatus) {
  const invoice = invoicesSnapshot.find((item) => item.id === invoiceId);

  if (!invoice) {
    return;
  }

  if (status === 'Paid') {
    const balance = calculateInvoiceBalance(invoice);

    if (balance > 0) {
      receiveInvoicePayment(invoiceId, {
        amount: balance,
        date: new Date().toISOString(),
      });
      return;
    }
  }

  invoicesSnapshot = invoicesSnapshot.map((item) =>
    item.id === invoiceId ? { ...item, status } : item
  );
  persistInvoices();
  addActivity(`Invoice #${invoice.invoice} marked ${status}`);
  refreshInvoiceStatuses();
  emitChange();
}

export function receiveInvoicePayment(invoiceId: string, paymentInput: ReceiveInvoicePaymentInput) {
  const invoice = invoicesSnapshot.find((item) => item.id === invoiceId);

  if (!invoice) {
    return;
  }

  const currentBalance = calculateInvoiceBalance(invoice);
  const receivedAmount = Math.min(Math.max(paymentInput.amount, 0), currentBalance);

  if (receivedAmount <= 0) {
    return;
  }

  const payment: InvoicePayment = {
    id: generateId(),
    amount: receivedAmount,
    date: paymentInput.date,
    notes: paymentInput.notes?.trim() || undefined,
  };

  invoicesSnapshot = invoicesSnapshot.map((item) => {
    if (item.id !== invoiceId) {
      return item;
    }

    const payments = [...(item.payments ?? []), payment];
    const updatedInvoice = { ...item, payments };
    const balance = calculateInvoiceBalance(updatedInvoice);

    return {
      ...updatedInvoice,
      status: balance <= 0 ? 'Paid' : item.status === 'Draft' ? 'Sent' : item.status,
    };
  });

  persistInvoices();
  addActivity(`Payment received: ${formatInvoiceAmount(receivedAmount)} from ${invoice.customer} for invoice #${invoice.invoice}`);
  refreshInvoiceStatuses();
  emitChange();
}

export function calculateInvoiceTotal(invoices: Invoice[]) {
  return invoices.reduce((total, invoice) => total + invoice.amount, 0);
}

export function isInvoiceWaitingToBePaid(invoice: Invoice) {
  return invoice.status === 'Sent' || invoice.status === 'Overdue' || invoice.status === 'Due Today';
}

export function calculateWaitingToBePaidTotal(invoices: Invoice[]) {
  return invoices.filter(isInvoiceWaitingToBePaid).reduce((total, invoice) => total + calculateInvoiceBalance(invoice), 0);
}

export function calculatePaidInvoiceTotal(invoices: Invoice[], comparisonDate = new Date()) {
  return invoices.reduce((total, invoice) => {
    const paymentsThisMonth = (invoice.payments ?? [])
      .filter((payment) => isSameMonth(payment.date, comparisonDate))
      .reduce((paymentTotal, payment) => paymentTotal + payment.amount, 0);

    if (paymentsThisMonth > 0) {
      return total + paymentsThisMonth;
    }

    if (invoice.status === 'Paid' && !invoice.payments?.length && isSameMonth(invoice.invoiceDate, comparisonDate)) {
      return total + invoice.amount;
    }

    return total;
  }, 0);
}

export function useInvoices() {
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
