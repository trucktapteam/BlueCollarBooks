import { useSyncExternalStore } from 'react';
import { getCurrentUserId } from './authStore';
import { loadExpenses } from './mockExpenses';
import { loadInvoices } from './mockInvoices';
import { supabase } from '@/lib/supabase';

// The bank feed (see api/plaid-transactions-sync.ts), read through the
// `bank_feed` view. A bank transaction is never "income" or "expense" by
// itself: the user links it to ONE thing in the books - something already
// recorded (preferred) or a new record made from it. Nothing here writes a
// table; every change is one database function that either does it all or
// changes nothing.

export type BankTxnState = 'needs_review' | 'unsure' | 'recorded' | 'excluded' | 'pending';

export type PlaidTransaction = {
  id: string;
  plaidAccountId: string;
  date: string;
  name: string;
  merchantName: string | null;
  // Cents. Plaid's sign convention: positive = money out of the account (or a
  // card purchase), negative = money in (a deposit, or a card payment/refund).
  amount: number;
  pending: boolean;
  plaidCategory: string | null;
  excluded: boolean;
  reviewState: 'open' | 'unsure';
  reviewNote: string | null;
  // The books account this transaction really belongs to. Never asked.
  accountId: string | null;
  accountName: string | null;
  accountType: 'asset' | 'liability' | null;
  matchId: string | null;
  matchKind: BankMatchKind | null;
  matchSide: 'from' | 'to' | null;
  matchCreatedEvent: boolean;
  state: BankTxnState;
};

export type BankMatchKind =
  | 'expense'
  | 'payment'
  | 'owner_draw'
  | 'owner_contribution'
  | 'transfer'
  | 'loan_received'
  | 'loan_payment'
  | 'refund';

type FeedRow = {
  id: string;
  plaid_account_id: string;
  date: string;
  name: string;
  merchant_name: string | null;
  amount: number;
  pending: boolean;
  plaid_category: string | null;
  excluded: boolean;
  review_state: 'open' | 'unsure';
  review_note: string | null;
  account_id: string | null;
  account_name: string | null;
  account_type: 'asset' | 'liability' | null;
  match_id: string | null;
  match_kind: BankMatchKind | null;
  match_side: 'from' | 'to' | null;
  match_created_event: boolean | null;
  state: BankTxnState;
};

function rowToTransaction(row: FeedRow): PlaidTransaction {
  return {
    id: row.id,
    plaidAccountId: row.plaid_account_id,
    date: row.date,
    name: row.name,
    merchantName: row.merchant_name,
    amount: row.amount,
    pending: row.pending,
    plaidCategory: row.plaid_category,
    excluded: row.excluded,
    reviewState: row.review_state,
    reviewNote: row.review_note,
    accountId: row.account_id,
    accountName: row.account_name,
    accountType: row.account_type,
    matchId: row.match_id,
    matchKind: row.match_kind,
    matchSide: row.match_side,
    matchCreatedEvent: row.match_created_event ?? false,
    state: row.state,
  };
}

let transactionsSnapshot: PlaidTransaction[] = [];
const listeners = new Set<() => void>();

function emitChange() {
  listeners.forEach((listener) => listener());
}

export async function loadPlaidTransactions(userId: string) {
  const { data, error } = await supabase
    .from('bank_feed')
    .select('*')
    .eq('user_id', userId)
    .order('date', { ascending: false });

  if (error) {
    console.error('Failed to load bank transactions', error);
    return;
  }

  transactionsSnapshot = ((data ?? []) as FeedRow[]).map(rowToTransaction);
  emitChange();
}

export function clearPlaidTransactions() {
  transactionsSnapshot = [];
  emitChange();
}

// ----- what the bank transaction might already be -----

export type BankCandidate = {
  kind: BankMatchKind;
  targetId: string;
  side: 'from' | 'to' | null;
  label: string;
  eventDate: string;
  amountCents: number;
  dayDiff: number;
};

type CandidateRow = {
  kind: BankMatchKind;
  target_id: string;
  side: 'from' | 'to' | null;
  label: string;
  event_date: string;
  amount_cents: number;
  day_diff: number;
};

// Things already in the books that look like this bank transaction (same
// account, same amount, close in date). Offered BEFORE creating anything new.
export async function loadBankCandidates(transactionId: string): Promise<BankCandidate[]> {
  const { data, error } = await supabase.rpc('bank_match_candidates', { p_txn: transactionId });
  if (error) {
    console.error('Failed to load suggestions', error);
    return [];
  }
  return ((data ?? []) as CandidateRow[]).map((row) => ({
    kind: row.kind,
    targetId: row.target_id,
    side: row.side,
    label: row.label,
    eventDate: row.event_date,
    amountCents: row.amount_cents,
    dayDiff: row.day_diff,
  }));
}

export type TransferProposal = {
  outTxn: string;
  inTxn: string;
  outAccountId: string;
  inAccountId: string;
  amountCents: number;
  outDate: string;
  inDate: string;
  kind: 'transfer' | 'card_payment';
  ambiguous: boolean;
};

type ProposalRow = {
  out_txn: string;
  in_txn: string;
  out_account_id: string;
  in_account_id: string;
  amount_cents: number;
  out_date: string;
  in_date: string;
  kind: 'transfer' | 'card_payment';
  ambiguous: boolean;
};

// Money that left one of your accounts and arrived in another for the same
// amount a day or two apart. Proposed only - the user confirms.
export async function loadTransferProposals(): Promise<TransferProposal[]> {
  const { data, error } = await supabase.rpc('bank_transfer_proposals');
  if (error) {
    console.error('Failed to load transfer suggestions', error);
    return [];
  }
  return ((data ?? []) as ProposalRow[]).map((row) => ({
    outTxn: row.out_txn,
    inTxn: row.in_txn,
    outAccountId: row.out_account_id,
    inAccountId: row.in_account_id,
    amountCents: row.amount_cents,
    outDate: row.out_date,
    inDate: row.in_date,
    kind: row.kind,
    ambiguous: row.ambiguous,
  }));
}

// ----- actions -----

// The database refuses to create something new while a plausible match is
// still unmatched (SQLSTATE BC001); the screen then shows the match instead.
export function isPossibleDuplicateError(error: unknown) {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'BC001';
}

async function afterChange() {
  const userId = getCurrentUserId();
  if (!userId) return;
  await Promise.all([loadPlaidTransactions(userId), loadExpenses(userId), loadInvoices(userId)]);
}

async function call<T = unknown>(name: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name, args);
  if (error) {
    // BC001 is an expected "match it first" answer, not a failure worth logging.
    if (!isPossibleDuplicateError(error)) console.error(`${name} failed`, error);
    throw error;
  }
  return data as T;
}

// Link to something already recorded (no new accounting is made).
export async function matchTransaction(transactionId: string, candidate: Pick<BankCandidate, 'kind' | 'targetId' | 'side'>) {
  await call('match_bank_transaction', {
    p_txn: transactionId,
    p_kind: candidate.kind,
    p_target: candidate.targetId,
    p_side: candidate.side,
  });
  await afterChange();
}

// Confirm that an outflow and an inflow are one transfer between your own accounts.
export async function confirmTransferPair(outTxn: string, inTxn: string) {
  await call('confirm_transfer_pair', { p_out: outTxn, p_in: inTxn });
  await afterChange();
}

export type ResolveKind =
  | 'expense'
  | 'owner_draw'
  | 'owner_contribution'
  | 'loan_payment'
  | 'loan_received'
  | 'transfer_to'
  | 'transfer_from'
  | 'customer_payment'
  | 'refund'
  | 'unsure';

export type ResolveParams = {
  category?: string;
  otherAccountId?: string;
  loanId?: string;
  interestCents?: number;
  name?: string;
  lender?: string;
  customerId?: string;
  applications?: { invoice_id: string; amount_cents: number }[];
  notes?: string;
  // "This is a separate one" - skips the match-first guard.
  confirmNew?: boolean;
};

// Record the bank transaction as a NEW event. Without confirmNew the database
// refuses (BC001) if something already recorded plausibly matches.
export async function resolveTransaction(transactionId: string, kind: ResolveKind, params: ResolveParams = {}) {
  await call('resolve_bank_transaction', {
    p_txn: transactionId,
    p_kind: kind,
    p_params: {
      category: params.category,
      other_account_id: params.otherAccountId,
      loan_id: params.loanId,
      interest_cents: params.interestCents,
      name: params.name,
      lender: params.lender,
      customer_id: params.customerId,
      applications: params.applications,
      notes: params.notes,
      confirm_new: params.confirmNew ? true : undefined,
    },
  });
  await afterChange();
}

// Unlinks; if this bank transaction created the record, that record is voided too.
export async function undoTransaction(transactionId: string) {
  await call('undo_bank_resolution', { p_txn: transactionId });
  await afterChange();
}

// "Not a business transaction" - ignored. The books will not match the bank
// until it is handled, which Reconciliation shows.
export async function excludeTransaction(transactionId: string) {
  await call('exclude_bank_transaction', { p_id: transactionId });
  await afterChange();
}

// Puts an excluded / "not sure" transaction back in review.
export async function restoreTransaction(transactionId: string) {
  await call('restore_bank_transaction', { p_id: transactionId });
  await afterChange();
}

// Waiting on the user: not recorded, not excluded. (Pending ones can be
// reviewed once the bank posts them.)
export function getTransactionsNeedingReview(transactions: PlaidTransaction[]) {
  return transactions.filter((txn) => txn.state === 'needs_review' || txn.state === 'unsure');
}

export function usePlaidTransactions() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => transactionsSnapshot,
    () => transactionsSnapshot
  );
}
