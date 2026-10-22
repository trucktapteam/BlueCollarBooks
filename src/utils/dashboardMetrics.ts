// The dashboard's headline numbers as one pure function. The formulas are
// lifted unchanged from src/app/dashboard.tsx so Stage A can pin down their
// current (known-wrong) behavior with tests; Stage E replaces them with
// ledger-derived values.
import { isSameMonthAsDate } from './date.ts';
import {
  calculateInvoiceTotal,
  calculatePaidInvoiceTotal,
  calculateWaitingToBePaidTotal,
  type InvoiceLike,
} from './invoiceMath.ts';

export type ExpenseLike = { amount: number; date: string };

export function computeDashboardMetrics(input: {
  invoices: InvoiceLike[];
  expenses: ExpenseLike[];
  bankBalanceTotal: number;
  now: Date;
}) {
  const { invoices, expenses, bankBalanceTotal, now } = input;
  const invoicesThisMonth = invoices.filter((invoice) => isSameMonthAsDate(invoice.invoiceDate, now));
  const moneyIn = calculateInvoiceTotal(invoicesThisMonth);
  const moneyOut = expenses
    .filter((expense) => isSameMonthAsDate(expense.date, now))
    .reduce((total, expense) => total + expense.amount, 0);
  const paidThisMonth = calculatePaidInvoiceTotal(invoices, now);
  return {
    moneyIn,
    moneyOut,
    profitThisMonth: moneyIn - moneyOut,
    paidThisMonth,
    waitingToBePaid: calculateWaitingToBePaidTotal(invoices),
    cashAvailable: bankBalanceTotal + paidThisMonth - moneyOut,
  };
}
