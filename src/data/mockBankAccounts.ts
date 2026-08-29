import { useSyncExternalStore } from 'react';
import { getCurrentUserId } from './authStore';
import { supabase } from '@/lib/supabase';

export type BankAccount = {
  id: string;
  name: string;
  last4: string;
  // Cents, like every other money value in the app (see src/utils/money.ts).
  balance: number;
  lastUpdated: string;
  // Null for manually-entered accounts (no UI for that currently exists,
  // but the column/type support it). Set for anything connected through
  // Plaid - see api/plaid-exchange-public-token.ts - and used to show a
  // Disconnect action only where it's actually meaningful.
  plaidItemId: string | null;
  // True when api/plaid-sync.ts hit an ITEM_LOGIN_REQUIRED-class error for
  // this account's connection - the bank needs the user to reconnect
  // (expired credentials, forced re-verification, etc.) before balances
  // can refresh again.
  needsReauth: boolean;
};

type BankAccountRow = {
  id: string;
  name: string;
  last4: string | null;
  balance: number;
  last_updated: string | null;
  plaid_item_id: string | null;
  needs_reauth: boolean | null;
};

function rowToBankAccount(row: BankAccountRow): BankAccount {
  return {
    id: row.id,
    name: row.name,
    last4: row.last4 ?? '',
    balance: row.balance,
    lastUpdated: row.last_updated ?? '',
    plaidItemId: row.plaid_item_id,
    needsReauth: row.needs_reauth ?? false,
  };
}

let bankAccountsSnapshot: BankAccount[] = [];
const listeners = new Set<() => void>();

function emitChange() {
  listeners.forEach((listener) => listener());
}

export async function loadBankAccounts(userId: string) {
  const { data, error } = await supabase
    .from('bank_accounts')
    .select('*')
    .eq('user_id', userId)
    .order('name', { ascending: true });

  if (error) {
    console.error('Failed to load bank accounts', error);
    return;
  }

  bankAccountsSnapshot = (data ?? []).map(rowToBankAccount);
  emitChange();
}

export function clearBankAccounts() {
  bankAccountsSnapshot = [];
  emitChange();
}

export async function saveBankAccounts(accounts: BankAccount[]) {
  const userId = getCurrentUserId();
  if (!userId) {
    throw new Error('You must be signed in to save bank accounts.');
  }

  const rows = accounts.map((account) => ({
    id: account.id,
    user_id: userId,
    name: account.name,
    last4: account.last4,
    balance: account.balance,
    last_updated: account.lastUpdated,
  }));

  const { error } = await supabase.from('bank_accounts').upsert(rows);
  if (error) {
    console.error('Failed to save bank accounts', error);
    throw error;
  }

  bankAccountsSnapshot = accounts;
  emitChange();
}

// Total cash across every bank account, in cents. Used as the baseline for
// the Dashboard's "Cash Available" figure - see src/app/index.tsx.
export function sumBankAccountBalances(accounts: BankAccount[]) {
  return accounts.reduce((total, account) => total + account.balance, 0);
}

export function useBankAccounts() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => bankAccountsSnapshot,
    () => bankAccountsSnapshot
  );
}
