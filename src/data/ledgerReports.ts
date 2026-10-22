import { supabase } from '@/lib/supabase';
import { toISODateString } from '@/utils/date';

// Every headline number and report comes from the books (database functions),
// never from adding up screens in the browser. Dates are the user's LOCAL
// calendar dates, sent explicitly so "this month" never depends on UTC.

export type DashboardSummary = {
  cashAvailableCents: number;
  moneyInCents: number;
  moneyOutCents: number;
  profitCents: number;
  waitingToBePaidCents: number;
  overdueCents: number;
  accountsWithoutStartingBalance: number;
  hasBankAccounts: boolean;
};

type DashboardRow = {
  cash_available_cents: number | string;
  money_in_cents: number | string;
  money_out_cents: number | string;
  profit_cents: number | string;
  waiting_to_be_paid_cents: number | string;
  overdue_cents: number | string;
  accounts_without_starting_balance: number;
  has_bank_accounts: boolean;
};

export function monthBounds(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { today: toISODateString(now), start: toISODateString(start), end: toISODateString(end) };
}

export function yearBounds(now = new Date()) {
  return {
    today: toISODateString(now),
    start: toISODateString(new Date(now.getFullYear(), 0, 1)),
    end: toISODateString(new Date(now.getFullYear(), 11, 31)),
  };
}

export async function fetchDashboardSummary(now = new Date()): Promise<DashboardSummary | null> {
  const { today, start, end } = monthBounds(now);
  const { data, error } = await supabase.rpc('dashboard_summary', {
    p_today: today,
    p_month_start: start,
    p_month_end: end,
  });
  if (error) {
    console.error('Failed to load the dashboard summary', error);
    return null;
  }
  const row = (Array.isArray(data) ? data[0] : data) as DashboardRow | undefined;
  if (!row) return null;
  return {
    cashAvailableCents: Number(row.cash_available_cents),
    moneyInCents: Number(row.money_in_cents),
    moneyOutCents: Number(row.money_out_cents),
    profitCents: Number(row.profit_cents),
    waitingToBePaidCents: Number(row.waiting_to_be_paid_cents),
    overdueCents: Number(row.overdue_cents),
    accountsWithoutStartingBalance: Number(row.accounts_without_starting_balance),
    hasBankAccounts: row.has_bank_accounts,
  };
}

export type ReportLine = { section: string; accountId: string | null; name: string; amountCents: number };

type ReportRow = { section: string; account_id: string | null; name: string; amount_cents: number | string };

function toLines(data: unknown): ReportLine[] {
  return ((data ?? []) as ReportRow[]).map((row) => ({
    section: row.section,
    accountId: row.account_id,
    name: row.name,
    amountCents: Number(row.amount_cents),
  }));
}

// basis 'cash' (default): income is money actually received, by the date it was received.
// basis 'accrual': income is what was invoiced, by invoice date. Expenses are the same on both.
export async function fetchProfitAndLoss(from: string, to: string, basis: 'cash' | 'accrual'): Promise<ReportLine[] | null> {
  const { data, error } = await supabase.rpc('report_profit_and_loss', { p_from: from, p_to: to, p_basis: basis });
  if (error) {
    console.error('Failed to load the profit and loss report', error);
    return null;
  }
  return toLines(data);
}

export async function fetchBalanceSheet(asOf: string): Promise<ReportLine[] | null> {
  const { data, error } = await supabase.rpc('report_balance_sheet', { p_as_of: asOf });
  if (error) {
    console.error('Failed to load the balance sheet', error);
    return null;
  }
  return toLines(data);
}

export type AgingLine = {
  invoiceId: string;
  customer: string;
  invoiceNumber: string;
  dueDate: string | null;
  balanceCents: number;
  daysPastDue: number | null;
  bucket: string;
};

type AgingRow = {
  invoice_id: string;
  customer: string;
  invoice_number: string;
  due_date: string | null;
  balance_cents: number | string;
  days_past_due: number | null;
  bucket: string;
};

export async function fetchArAging(asOf: string): Promise<AgingLine[] | null> {
  const { data, error } = await supabase.rpc('ar_aging_as_of', { p_as_of: asOf });
  if (error) {
    console.error('Failed to load who owes you', error);
    return null;
  }
  return ((data ?? []) as AgingRow[]).map((row) => ({
    invoiceId: row.invoice_id,
    customer: row.customer,
    invoiceNumber: row.invoice_number,
    dueDate: row.due_date,
    balanceCents: Number(row.balance_cents),
    daysPastDue: row.days_past_due,
    bucket: row.bucket,
  }));
}
