import { supabase } from '@/lib/supabase';

// Does the bank agree with the books? This only READS (database views). It
// explains a difference as far as it can and calls the rest "unexplained";
// it never adds an entry to make numbers match.

export type ReconciliationStatus = 'agrees' | 'explained_by_open_items' | 'unexplained' | 'needs_starting_balance';

export type AccountReconciliation = {
  accountId: string;
  name: string;
  isCard: boolean;
  bankBalanceCents: number;
  bankBalanceAsOf: string | null;
  needsReauth: boolean;
  booksBalanceCents: number;
  startingAsOf: string | null;
  differenceCents: number;
  explainedCents: number;
  unexplainedCents: number | null;
  status: ReconciliationStatus;
  unrecordedCount: number;
  unrecordedCents: number;
  ignoredCount: number;
  ignoredCents: number;
  unlinkedCount: number;
  unlinkedCents: number;
  pendingCount: number;
  pendingCents: number;
  beforeStartCount: number;
};

export type UnlinkedItem = {
  accountId: string;
  sourceType: string;
  sourceId: string;
  entryDate: string;
  memo: string | null;
  effectCents: number;
  afterStart: boolean;
};

type AccountRow = {
  account_id: string;
  account_name: string;
  account_type: string;
  bank_balance_cents: number;
  bank_balance_as_of: string | null;
  needs_reauth: boolean;
  books_balance_cents: number;
  starting_as_of: string | null;
  difference_cents: number;
  explained_cents: number;
  unexplained_cents: number | null;
  status: ReconciliationStatus;
  unrecorded_count: number;
  unrecorded_cents: number;
  ignored_count: number;
  ignored_cents: number;
  unlinked_count: number;
  unlinked_cents: number;
  pending_count: number;
  pending_cents: number;
  before_start_count: number;
};

export async function loadReconciliation(): Promise<{ accounts: AccountReconciliation[]; unlinked: UnlinkedItem[] }> {
  const [accounts, unlinked] = await Promise.all([
    supabase.from('reconciliation_accounts').select('*').order('account_name', { ascending: true }),
    supabase.from('reconciliation_unlinked_items').select('*').order('entry_date', { ascending: false }),
  ]);
  if (accounts.error) console.error('Failed to load reconciliation', accounts.error);
  if (unlinked.error) console.error('Failed to load unmatched records', unlinked.error);
  return {
    accounts: ((accounts.data ?? []) as AccountRow[]).map((r) => ({
      accountId: r.account_id,
      name: r.account_name,
      isCard: r.account_type === 'liability',
      bankBalanceCents: r.bank_balance_cents,
      bankBalanceAsOf: r.bank_balance_as_of,
      needsReauth: r.needs_reauth,
      booksBalanceCents: r.books_balance_cents,
      startingAsOf: r.starting_as_of,
      differenceCents: r.difference_cents,
      explainedCents: r.explained_cents,
      unexplainedCents: r.unexplained_cents,
      status: r.status,
      unrecordedCount: r.unrecorded_count,
      unrecordedCents: r.unrecorded_cents,
      ignoredCount: r.ignored_count,
      ignoredCents: r.ignored_cents,
      unlinkedCount: r.unlinked_count,
      unlinkedCents: r.unlinked_cents,
      pendingCount: r.pending_count,
      pendingCents: r.pending_cents,
      beforeStartCount: r.before_start_count,
    })),
    unlinked: ((unlinked.data ?? []) as {
      account_id: string;
      source_type: string;
      source_id: string;
      entry_date: string;
      memo: string | null;
      effect_cents: number;
      after_start: boolean;
    }[]).map((r) => ({
      accountId: r.account_id,
      sourceType: r.source_type,
      sourceId: r.source_id,
      entryDate: r.entry_date,
      memo: r.memo,
      effectCents: r.effect_cents,
      afterStart: r.after_start,
    })),
  };
}

export type ReceivablesCheck = { ledgerCents: number; openInvoicesCents: number; unappliedCents: number; differenceCents: number };

// Money owed to you: what the books say vs. open invoices minus payments not yet matched to an invoice.
export async function loadReceivablesCheck(todayISO: string): Promise<ReceivablesCheck | null> {
  const { data, error } = await supabase.rpc('ar_reconciliation_as_of', { p_as_of: todayISO });
  if (error || !data || (Array.isArray(data) && data.length === 0)) {
    if (error) console.error('Failed to load receivables check', error);
    return null;
  }
  const row = (Array.isArray(data) ? data[0] : data) as {
    ledger_ar_cents: number;
    open_invoices_cents: number;
    unapplied_payments_cents: number;
    difference_cents: number;
  };
  return {
    ledgerCents: row.ledger_ar_cents,
    openInvoicesCents: row.open_invoices_cents,
    unappliedCents: row.unapplied_payments_cents,
    differenceCents: row.difference_cents,
  };
}
