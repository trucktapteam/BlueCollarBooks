// Pure per-invoice math, split out of src/data/mockInvoices.ts so it can be
// unit-tested in plain Node (that file pulls in React and Supabase). Totals for
// the dashboard and reports are NOT computed here any more - they come from the
// books (src/data/ledgerReports.ts). What an invoice has been paid is whatever
// payments have been applied to it.
type PaymentLike = { amount: number; date: string };
export type InvoiceLike = {
  amount: number;
  status: string;
  invoiceDate: string;
  payments?: PaymentLike[];
};

export function calculateInvoicePaymentTotal(invoice: InvoiceLike) {
  // Paid is whatever payments have been applied to the invoice - a status label never counts as money.
  const appliedTotal = (invoice.payments ?? []).reduce((total, payment) => total + payment.amount, 0);
  return Math.min(appliedTotal, invoice.amount);
}

export function calculateInvoiceBalance(invoice: InvoiceLike) {
  return Math.max(invoice.amount - calculateInvoicePaymentTotal(invoice), 0);
}

export function isInvoiceWaitingToBePaid(invoice: InvoiceLike) {
  return invoice.status === 'Sent' || invoice.status === 'Overdue' || invoice.status === 'Due Today';
}
