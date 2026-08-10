import { useSyncExternalStore } from 'react';
import { addActivity } from './activityStore';
import { getCurrentUserId } from './authStore';
import { isSameMonth } from './mockInvoices';
import { generateId } from '@/utils/id';
import { formatMoneyCents } from '@/utils/money';
import { supabase } from '@/lib/supabase';

export type Expense = {
  id: string;
  date: string;
  vendor: string;
  category: string;
  // Cents, like every other money value in the app (see src/utils/money.ts).
  amount: number;
  notes: string;
  receipt?: ExpenseReceipt;
};

export type ExpenseReceipt = {
  id: string;
  name: string;
  type: string;
  dateAdded: string;
  size?: number;
  objectUrl?: string;
};

export type ExpenseReceiptInput = {
  name: string;
  type: string;
  size?: number;
  objectUrl?: string;
};

export const expenseCategories = [
  'Fuel',
  'Repairs',
  'Insurance',
  'Permits',
  'Tolls',
  'Meals',
  'Office',
  'Software',
  'Other',
];

export const expenseDraft = {
  date: '06/09/2026',
  vendor: 'Loves Travel Stop',
  category: 'Fuel',
  amount: '$324',
  notes: 'Diesel fill-up',
};

type ExpenseRow = {
  id: string;
  date: string | null;
  vendor: string;
  category: string | null;
  amount: number;
  notes: string | null;
  expense_receipts: ExpenseReceiptRow[] | null;
};

type ExpenseReceiptRow = {
  id: string;
  name: string;
  type: string;
  date_added: string;
  size: number | null;
};

function rowToExpense(row: ExpenseRow): Expense {
  const receiptRow = row.expense_receipts?.[0];
  return {
    id: row.id,
    date: row.date ?? '',
    vendor: row.vendor,
    category: row.category ?? '',
    amount: row.amount,
    notes: row.notes ?? '',
    receipt: receiptRow
      ? {
          id: receiptRow.id,
          name: receiptRow.name,
          type: receiptRow.type,
          dateAdded: receiptRow.date_added,
          size: receiptRow.size ?? undefined,
        }
      : undefined,
  };
}

let expensesSnapshot: Expense[] = [];
const listeners = new Set<() => void>();

function emitChange() {
  listeners.forEach((listener) => listener());
}

export async function loadExpenses(userId: string) {
  const { data, error } = await supabase
    .from('expenses')
    .select('*, expense_receipts(*)')
    .eq('user_id', userId)
    .order('date', { ascending: false });

  if (error) {
    console.error('Failed to load expenses', error);
    return;
  }

  expensesSnapshot = (data ?? []).map(rowToExpense);
  emitChange();
}

export function clearExpenses() {
  expensesSnapshot = [];
  emitChange();
}

export function addExpense(expense: Expense) {
  saveExpense({ ...expense, id: expense.id ?? generateId() });
}

export async function saveExpense(expense: Expense, originalId?: string) {
  const userId = getCurrentUserId();
  if (!userId) {
    throw new Error('You must be signed in to save an expense.');
  }

  const lookupId = originalId ?? expense.id;
  const existingIndex = expensesSnapshot.findIndex((item) => item.id === lookupId);
  const existingExpense = existingIndex >= 0 ? expensesSnapshot[existingIndex] : undefined;
  const expenseToSave: Expense = {
    ...expense,
    id: lookupId ?? generateId(),
    receipt: expense.receipt ?? existingExpense?.receipt,
  };

  const { error } = await supabase.from('expenses').upsert({
    id: expenseToSave.id,
    user_id: userId,
    date: expenseToSave.date,
    vendor: expenseToSave.vendor,
    category: expenseToSave.category,
    amount: expenseToSave.amount,
    notes: expenseToSave.notes,
  });

  if (error) {
    console.error('Failed to save expense', error);
    throw error;
  }

  if (existingIndex >= 0) {
    expensesSnapshot = expensesSnapshot.map((item, index) => (index === existingIndex ? expenseToSave : item));
    addActivity(`Expense updated: ${expenseToSave.vendor} ${formatMoneyCents(expenseToSave.amount)}`);
  } else {
    expensesSnapshot = [expenseToSave, ...expensesSnapshot];
    addActivity(`Expense added: ${expenseToSave.vendor} ${formatMoneyCents(expenseToSave.amount)}`);
  }

  emitChange();
}

async function upsertReceipt(expenseId: string, receipt: ExpenseReceipt) {
  const userId = getCurrentUserId();
  if (!userId) {
    throw new Error('You must be signed in to attach a receipt.');
  }

  const { error } = await supabase.from('expense_receipts').upsert({
    id: receipt.id,
    expense_id: expenseId,
    user_id: userId,
    name: receipt.name,
    type: receipt.type,
    date_added: receipt.dateAdded,
    size: receipt.size ?? null,
  });

  if (error) {
    console.error('Failed to save receipt', error);
    throw error;
  }
}

export async function attachExpenseReceipt(expenseId: string, receiptInput?: ExpenseReceiptInput) {
  const expense = expensesSnapshot.find((item) => item.id === expenseId);
  if (!expense) {
    return;
  }

  const receipt: ExpenseReceipt = {
    id: generateId(),
    name: receiptInput?.name || `${expense.vendor.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-receipt.pdf`,
    type: receiptInput?.type || 'application/pdf',
    dateAdded: new Date().toISOString(),
    size: receiptInput?.size,
    objectUrl: receiptInput?.objectUrl,
  };

  await upsertReceipt(expenseId, receipt);

  expensesSnapshot = expensesSnapshot.map((item) => (item.id === expenseId ? { ...item, receipt } : item));
  addActivity(`Receipt attached: ${expense.vendor} ${receipt.name}`);
  emitChange();
}

export async function reattachExpenseReceipt(expenseId: string, receiptInput: ExpenseReceiptInput) {
  const expense = expensesSnapshot.find((item) => item.id === expenseId);
  if (!expense?.receipt) {
    return;
  }

  if (typeof URL !== 'undefined' && expense.receipt.objectUrl?.startsWith('blob:')) {
    URL.revokeObjectURL(expense.receipt.objectUrl);
  }

  const receipt: ExpenseReceipt = {
    ...expense.receipt,
    name: receiptInput.name,
    type: receiptInput.type,
    size: receiptInput.size,
    objectUrl: receiptInput.objectUrl,
  };

  await upsertReceipt(expenseId, receipt);

  expensesSnapshot = expensesSnapshot.map((item) => (item.id === expenseId ? { ...item, receipt } : item));
  addActivity(`Receipt reattached: ${expense.vendor} ${receiptInput.name}`);
  emitChange();
}

export async function deleteExpenseReceipt(expenseId: string) {
  const expense = expensesSnapshot.find((item) => item.id === expenseId);
  if (!expense?.receipt) {
    return;
  }

  if (typeof URL !== 'undefined' && expense.receipt.objectUrl?.startsWith('blob:')) {
    URL.revokeObjectURL(expense.receipt.objectUrl);
  }

  const { error } = await supabase.from('expense_receipts').delete().eq('id', expense.receipt.id);
  if (error) {
    console.error('Failed to delete receipt', error);
    throw error;
  }

  const deletedReceiptName = expense.receipt.name;
  expensesSnapshot = expensesSnapshot.map((item) => (item.id === expenseId ? { ...item, receipt: undefined } : item));
  addActivity(`Receipt deleted: ${expense.vendor} ${deletedReceiptName}`);
  emitChange();
}

export function calculateTotalMonthlyExpenses(expenses: Expense[], comparisonDate = new Date()) {
  return expenses
    .filter((expense) => isSameMonth(expense.date, comparisonDate))
    .reduce((total, expense) => total + expense.amount, 0);
}

export function useExpenses() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => expensesSnapshot,
    () => expensesSnapshot
  );
}
