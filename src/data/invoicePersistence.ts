// The database writes behind saveInvoice(), with the Supabase client injected
// so they can be tested against an in-memory fake. Moved verbatim from
// mockInvoices.ts - behavior is unchanged (including the known
// delete-then-insert non-atomicity that Stage C replaces with one atomic
// database function).
import { computeDueDate, toISODateString } from '../utils/date.ts';

export type DbError = { code?: string; message?: string };
type Result = PromiseLike<{ error: DbError | null }>;

export type InvoiceDbClient = {
  from(table: string): {
    upsert(row: Record<string, unknown>): Result;
    insert(rows: Record<string, unknown>[]): Result;
    delete(): { eq(column: string, value: string): Result };
  };
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
  lineItems?: { id: string; description: string; amount: number }[];
};

// Stored alongside terms so the due date is a fact in the database, not
// something every screen re-derives. Null if the invoice date is missing.
function dueDateFor(invoice: PersistableInvoice): string | null {
  const due = computeDueDate(invoice.invoiceDate, invoice.terms);
  return due ? toISODateString(due) : null;
}

export async function writeInvoiceRows(client: InvoiceDbClient, userId: string, invoice: PersistableInvoice) {
  const { error: invoiceError } = await client.from('invoices').upsert({
    id: invoice.id,
    user_id: userId,
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
    updated_at: new Date().toISOString(),
  });
  if (invoiceError) throw invoiceError;

  const lineItems = invoice.lineItems ?? [];
  const { error: deleteError } = await client.from('invoice_line_items').delete().eq('invoice_id', invoice.id);
  if (deleteError) throw deleteError;

  if (lineItems.length > 0) {
    const { error: lineItemsError } = await client.from('invoice_line_items').insert(
      lineItems.map((item, index) => ({
        id: item.id,
        invoice_id: invoice.id,
        user_id: userId,
        description: item.description,
        amount: item.amount,
        position: index,
      }))
    );
    if (lineItemsError) throw lineItemsError;
  }
}
