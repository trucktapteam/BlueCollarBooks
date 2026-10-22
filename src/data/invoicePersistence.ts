// The database write behind saveInvoice(), with the Supabase client injected so it can be tested.
// The whole save (invoice row + line items) is ONE call to the save_invoice database function, which
// runs as a single transaction and updates line items in place by their stable ids - so a failure
// can never leave an invoice without its line items (see tests/sql/invoice_save.sql).
import { computeDueDate, toISODateString } from '../utils/date.ts';

export type DbError = { code?: string; message?: string };

export type InvoiceDbClient = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ error: DbError | null }>;
};

export type PersistableInvoice = {
  id: string;
  invoice: string;
  customer: string;
  customerId?: string;
  amount: number;
  status: string;
  invoiceDate: string;
  terms?: string;
  poNumber?: string;
  bolNumber?: string;
  shipper?: string;
  consignee?: string;
  freightDescription?: string;
  lineItems?: { id: string; description: string; amount: number; serviceDate?: string; quantity?: number; rateCents?: number }[];
};

// Stored alongside terms so the due date is a fact in the database, not
// something every screen re-derives. Null if the invoice date is missing.
function dueDateFor(invoice: PersistableInvoice): string | null {
  const due = computeDueDate(invoice.invoiceDate, invoice.terms);
  return due ? toISODateString(due) : null;
}

export async function writeInvoiceRows(client: InvoiceDbClient, _userId: string, invoice: PersistableInvoice) {
  const { error } = await client.rpc('save_invoice', {
    p_invoice: {
      id: invoice.id,
      invoice_number: invoice.invoice,
      customer: invoice.customer,
      customer_id: invoice.customerId ?? null,
      amount: invoice.amount,
      status: invoice.status,
      invoice_date: invoice.invoiceDate || null,
      terms: invoice.terms ?? null,
      due_date: dueDateFor(invoice),
      po_number: invoice.poNumber ?? null,
      bol_number: invoice.bolNumber ?? null,
      shipper: invoice.shipper ?? null,
      consignee: invoice.consignee ?? null,
      freight_description: invoice.freightDescription ?? null,
    },
    p_lines: (invoice.lineItems ?? []).map((item) => ({
      id: item.id,
      description: item.description,
      amount: item.amount,
      service_date: item.serviceDate ?? null,
      quantity: item.quantity ?? 1,
      rate_cents: item.rateCents ?? null,
    })),
  });
  if (error) throw error;
}
