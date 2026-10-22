// Pure invoice/dashboard math, split out of src/data/mockInvoices.ts so it can
// be unit-tested in plain Node (that file pulls in React and Supabase). The
// functions are moved verbatim - mockInvoices.ts re-exports them under the
// same names, so no call site changes and behavior is identical.
import { isSameMonthAsDate } from './date.ts';

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

export function calculateInvoiceTotal(invoices: InvoiceLike[]) {
  return invoices.reduce((total, invoice) => total + invoice.amount, 0);
}

export function isInvoiceWaitingToBePaid(invoice: InvoiceLike) {
  return invoice.status === 'Sent' || invoice.status === 'Overdue' || invoice.status === 'Due Today';
}

export function calculateWaitingToBePaidTotal(invoices: InvoiceLike[]) {
  return invoices.filter(isInvoiceWaitingToBePaid).reduce((total, invoice) => total + calculateInvoiceBalance(invoice), 0);
}

export function calculatePaidInvoiceTotal(invoices: InvoiceLike[], comparisonDate = new Date()) {
  return invoices.reduce((total, invoice) => {
    const paymentsThisMonth = (invoice.payments ?? [])
      .filter((payment) => isSameMonthAsDate(payment.date, comparisonDate))
      .reduce((paymentTotal, payment) => paymentTotal + payment.amount, 0);

    if (paymentsThisMonth > 0) {
      return total + paymentsThisMonth;
    }

    if (invoice.status === 'Paid' && !invoice.payments?.length && isSameMonthAsDate(invoice.invoiceDate, comparisonDate)) {
      return total + invoice.amount;
    }

    return total;
  }, 0);
}
