// Builds the Invoice object the New Invoice form hands to saveInvoice().
// Extracted from new-invoice.tsx (persistInvoice) so the exact set of fields
// that reach the database can be tested.
import { normalizeDateToISO } from './date.ts';

export type InvoiceFormValues = {
  id: string;
  number: string;
  customer: string;
  customerId?: string;
  amountCents: number;
  status: string;
  date: string;
  terms: string;
  poNumber: string;
  bolNumber: string;
  shipper: string;
  consignee: string;
  freightDescription: string;
  lineItems: { id: string; description: string; amount: number }[];
};

export function buildInvoiceForSave(form: InvoiceFormValues) {
  return {
    id: form.id,
    invoice: form.number,
    customer: form.customer.trim(),
    customerId: form.customerId,
    amount: form.amountCents,
    status: form.status,
    invoiceDate: normalizeDateToISO(form.date),
    poNumber: form.poNumber,
    bolNumber: form.bolNumber,
    shipper: form.shipper,
    consignee: form.consignee,
    freightDescription: form.freightDescription,
    lineItems: form.lineItems,
  };
}
