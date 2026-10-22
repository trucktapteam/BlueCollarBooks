import test from 'node:test';
import assert from 'node:assert/strict';
import { computeDashboardMetrics } from '../src/utils/dashboardMetrics.ts';

const now = new Date(2026, 5, 15); // June 15 2026
const inv = (amount: number, status: string, invoiceDate: string, payments: { amount: number; date: string }[] = []) => ({
  amount, status, invoiceDate, payments,
});

test('waiting-to-be-paid only counts sent/due/overdue balances', () => {
  const m = computeDashboardMetrics({
    invoices: [inv(10000, 'Sent', '2026-06-01'), inv(20000, 'Overdue', '2026-05-01'), inv(30000, 'Draft', '2026-06-02'), inv(40000, 'Paid', '2026-06-03')],
    expenses: [], bankBalanceTotal: 0, now,
  });
  assert.equal(m.waitingToBePaid, 30000);
});

// KNOWN BUG (audit): "Money In" sums every invoice dated this month, including
// drafts and invoices nobody has paid. Under the agreed cash-basis default,
// income is money actually received.
test('money in excludes drafts and unpaid invoices', { todo: 'income counts all invoices' }, () => {
  const m = computeDashboardMetrics({
    invoices: [inv(10000, 'Draft', '2026-06-01'), inv(20000, 'Sent', '2026-06-02'), inv(30000, 'Paid', '2026-06-03', [{ amount: 30000, date: '2026-06-10' }])],
    expenses: [], bankBalanceTotal: 0, now,
  });
  assert.equal(m.moneyIn, 30000);
});

// KNOWN BUG (audit): bank balances already include money received and spent,
// but Cash Available adds paid-this-month and subtracts expenses on top of
// them, double-counting both.
test('cash available equals the real bank balance (no double counting)', { todo: 'cash adds payments and subtracts expenses again' }, () => {
  const m = computeDashboardMetrics({
    invoices: [inv(62500, 'Paid', '2026-06-01', [{ amount: 62500, date: '2026-06-05' }])],
    expenses: [{ amount: 10000, date: '2026-06-06' }],
    bankBalanceTotal: 1_000_000, now,
  });
  assert.equal(m.cashAvailable, 1_000_000);
});
