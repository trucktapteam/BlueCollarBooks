import { useSyncExternalStore } from 'react';
import { supabase } from '@/lib/supabase';

// The real accounts money moves through, read from the books (`accounts`).
// The customer never sees ledger terms: a bank account or card is just
// "Chase Checking (1234)"; the owner's own pocket is "I paid personally".
export type MoneyAccount = {
  id: string;
  name: string;
  kind: 'bank' | 'card';
  bankAccountId: string;
};

export const PAID_PERSONALLY_LABEL = 'I paid personally';

type AccountRow = {
  id: string;
  name: string;
  type: 'asset' | 'liability' | 'equity' | 'income' | 'expense';
  system_key: string | null;
  bank_account_id: string | null;
};

export type LedgerAccountsSnapshot = {
  loaded: boolean;
  // Bank and credit-card accounts, in name order.
  moneyAccounts: MoneyAccount[];
  // The account that records "the owner paid with personal funds"; null until the books exist.
  ownerPaidAccountId: string | null;
};

const EMPTY: LedgerAccountsSnapshot = { loaded: false, moneyAccounts: [], ownerPaidAccountId: null };

let snapshot: LedgerAccountsSnapshot = EMPTY;
const listeners = new Set<() => void>();

function emitChange() {
  listeners.forEach((listener) => listener());
}

// Makes sure the books have an account for every connected bank/card, then
// loads them. Safe to call repeatedly (ensure_books is idempotent).
export async function loadLedgerAccounts(userId: string) {
  const ensured = await supabase.rpc('ensure_books');
  if (ensured.error) {
    console.error('Failed to set up the books', ensured.error);
    return;
  }

  const { data, error } = await supabase
    .from('accounts')
    .select('id, name, type, system_key, bank_account_id')
    .eq('user_id', userId)
    .eq('is_active', true)
    .order('name', { ascending: true });

  if (error) {
    console.error('Failed to load accounts', error);
    return;
  }

  const rows = (data ?? []) as AccountRow[];
  snapshot = {
    loaded: true,
    moneyAccounts: rows
      .filter((row) => row.bank_account_id && (row.type === 'asset' || row.type === 'liability'))
      .map((row) => ({
        id: row.id,
        name: row.name,
        kind: row.type === 'liability' ? ('card' as const) : ('bank' as const),
        bankAccountId: row.bank_account_id as string,
      })),
    ownerPaidAccountId: rows.find((row) => row.system_key === 'owner_contributions')?.id ?? null,
  };
  emitChange();
}

export function clearLedgerAccounts() {
  snapshot = EMPTY;
  emitChange();
}

// Where an existing expense was paid from, read from its posted entry.
// Returns null when the expense has no posted entry.
export async function loadExpensePaidFrom(expenseId: string): Promise<string | null> {
  const { data: entry, error: entryError } = await supabase
    .from('journal_entry_trace')
    .select('id')
    .eq('source_type', 'expense')
    .eq('source_id', expenseId)
    .eq('status', 'active')
    .maybeSingle();
  if (entryError || !entry) {
    if (entryError) console.error('Failed to look up the expense entry', entryError);
    return null;
  }

  const { data: lines, error: lineError } = await supabase
    .from('journal_lines')
    .select('account_id, credit_cents')
    .eq('entry_id', entry.id)
    .gt('credit_cents', 0);
  if (lineError || !lines?.length) {
    if (lineError) console.error('Failed to look up the expense funding', lineError);
    return null;
  }
  return lines[0].account_id as string;
}

export type StartingBalance = { accountId: string; amountCents: number; asOf: string };

// The starting balance the user entered for each bank/card account (cards: the
// amount owed, positive). Accounts without one are not listed.
export async function loadStartingBalances(): Promise<StartingBalance[]> {
  const { data, error } = await supabase.from('opening_balances').select('account_id, amount_cents, as_of');
  if (error) {
    console.error('Failed to load starting balances', error);
    return [];
  }
  return (data ?? []).map((row) => ({
    accountId: row.account_id as string,
    amountCents: Number(row.amount_cents),
    asOf: row.as_of as string,
  }));
}

// Sets (or changes - the old one is reversed in the books) what an account
// held on a given date. Zero clears it.
export async function setStartingBalance(accountId: string, amountCents: number, asOf: string) {
  const { error } = await supabase.rpc('set_opening_balance', {
    p_account_id: accountId,
    p_amount_cents: amountCents,
    p_as_of: asOf,
  });
  if (error) {
    console.error('Failed to set starting balance', error);
    throw error;
  }
}

export function useLedgerAccounts() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => snapshot,
    () => snapshot
  );
}
