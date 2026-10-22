import { useSyncExternalStore } from 'react';
import { getCurrentUserId } from './authStore';
import { loadExpenses } from './mockExpenses';
import { supabase } from '@/lib/supabase';

// Bank transactions pulled from Plaid (see api/plaid-transactions-sync.ts),
// staged for the user to turn into real Expense rows. This is deliberately
// a separate store from mockExpenses.ts - a PlaidTransaction only becomes
// an Expense once the user categorizes it (categorizeTransaction below),
// same as a bank feed in any bookkeeping tool.
export type PlaidTransaction = {
  id: string;
  plaidItemId: string;
  plaidAccountId: string;
  date: string;
  name: string;
  merchantName: string | null;
  // Cents. Plaid's own sign convention for depository accounts: positive =
  // money out (a candidate expense), negative = money in (a deposit) - see
  // src/app/transactions.tsx, which only surfaces positive amounts for
  // categorization.
  amount: number;
  pending: boolean;
  plaidCategory: string | null;
  category: string | null;
  excluded: boolean;
  expenseId: string | null;
};

type PlaidTransactionRow = {
  id: string;
  plaid_item_id: string;
  plaid_account_id: string;
  date: string;
  name: string;
  merchant_name: string | null;
  amount: number;
  pending: boolean;
  plaid_category: string | null;
  category: string | null;
  excluded: boolean;
  expense_id: string | null;
};

function rowToTransaction(row: PlaidTransactionRow): PlaidTransaction {
  return {
    id: row.id,
    plaidItemId: row.plaid_item_id,
    plaidAccountId: row.plaid_account_id,
    date: row.date,
    name: row.name,
    merchantName: row.merchant_name,
    amount: row.amount,
    pending: row.pending,
    plaidCategory: row.plaid_category,
    category: row.category,
    excluded: row.excluded,
    expenseId: row.expense_id,
  };
}

let transactionsSnapshot: PlaidTransaction[] = [];
const listeners = new Set<() => void>();

function emitChange() {
  listeners.forEach((listener) => listener());
}

export async function loadPlaidTransactions(userId: string) {
  const { data, error } = await supabase
    .from('plaid_transactions')
    .select('*')
    .eq('user_id', userId)
    .order('date', { ascending: false });

  if (error) {
    console.error('Failed to load bank transactions', error);
    return;
  }

  transactionsSnapshot = (data ?? []).map(rowToTransaction);
  emitChange();
}

export function clearPlaidTransactions() {
  transactionsSnapshot = [];
  emitChange();
}

// Turns a bank transaction into a real Expense (so it shows up in Expenses,
// Reports, and the Money Out By Type breakdown like anything else), and
// marks the transaction itself as categorized so it drops out of the
// review queue. The Expense and the transaction are linked via expense_id
// so re-syncing never double-counts it.
//
// One database transaction (categorize_plaid_transaction): the expense is
// created, recorded in the books as paid from THIS transaction's own
// connected bank account / card, and linked - or none of it happens.
export async function categorizeTransaction(transaction: PlaidTransaction, category: string) {
  const userId = getCurrentUserId();
  if (!userId) {
    throw new Error('You must be signed in to categorize a transaction.');
  }

  const { data, error } = await supabase.rpc('categorize_plaid_transaction', {
    p_transaction_id: transaction.id,
    p_category: category,
  });

  if (error) {
    console.error('Failed to categorize transaction', error);
    throw error;
  }

  const expenseId = data as string;
  transactionsSnapshot = transactionsSnapshot.map((item) =>
    item.id === transaction.id ? { ...item, category, expenseId } : item
  );
  emitChange();
  // The new expense lives in the expenses store; refresh it so Expenses shows it.
  await loadExpenses(userId);
}

// Marks a transaction as "not a business expense" (a transfer, a credit
// card payment, personal spending) so it stops showing up in the review
// queue without ever becoming an Expense.
export async function excludeTransaction(transactionId: string) {
  const userId = getCurrentUserId();
  if (!userId) {
    throw new Error('You must be signed in to update a transaction.');
  }

  const { error } = await supabase
    .from('plaid_transactions')
    .update({ excluded: true, updated_at: new Date().toISOString() })
    .eq('id', transactionId)
    .eq('user_id', userId);

  if (error) {
    console.error('Failed to exclude transaction', error);
    throw error;
  }

  transactionsSnapshot = transactionsSnapshot.map((item) =>
    item.id === transactionId ? { ...item, excluded: true } : item
  );
  emitChange();
}

// Undoes excludeTransaction - brings a transaction back into the review
// queue if the user excluded it by mistake.
export async function restoreTransaction(transactionId: string) {
  const userId = getCurrentUserId();
  if (!userId) {
    throw new Error('You must be signed in to update a transaction.');
  }

  const { error } = await supabase
    .from('plaid_transactions')
    .update({ excluded: false, updated_at: new Date().toISOString() })
    .eq('id', transactionId)
    .eq('user_id', userId);

  if (error) {
    console.error('Failed to restore transaction', error);
    throw error;
  }

  transactionsSnapshot = transactionsSnapshot.map((item) =>
    item.id === transactionId ? { ...item, excluded: false } : item
  );
  emitChange();
}

// Money-out transactions still waiting on the user to categorize or
// exclude them - the count shown as a badge on Dashboard/Expenses, and the
// list rendered on the Transactions review screen.
export function getTransactionsNeedingReview(transactions: PlaidTransaction[]) {
  return transactions.filter((txn) => txn.amount > 0 && !txn.excluded && !txn.expenseId);
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
