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
  // In-tab-only preview (URL.createObjectURL) - gone after refresh/new tab.
  objectUrl?: string;
  // Path in the `receipts` Supabase Storage bucket - durable across
  // refreshes/devices. Older receipts saved before this existed may have
  // neither this nor objectUrl set, in which case the file itself is gone
  // and the user needs to re-upload.
  storagePath?: string;
};

export type ExpenseReceiptInput = {
  name: string;
  type: string;
  size?: number;
  objectUrl?: string;
  storagePath?: string;
};

// Blank-form defaults for a brand-new expense - date defaults to today in
// new-expense.tsx; vendor/amount/notes are deliberately empty, not sample
// data. This used to default to a fake vendor/amount ("Loves Travel Stop",
// "$324") left over from local development. category starts blank rather
// than a hardcoded value since categories are now user-editable (see
// mockCategories.ts) - new-expense.tsx fills it in once the user's own
// category list has loaded.
export const expenseDraft = {
  vendor: '',
  category: '',
  amount: '$0',
  notes: '',
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
  storage_path: string | null;
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
          storagePath: receiptRow.storage_path ?? undefined,
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
    storage_path: receipt.storagePath ?? null,
  });

  if (error) {
    console.error('Failed to save receipt', error);
    throw error;
  }
}

// Uploads the actual file bytes to the private `receipts` Storage bucket so
// the receipt survives a refresh/new device, not just its metadata. Path is
// namespaced by user id first (matches the bucket's RLS policies) then
// expense id.
export async function uploadReceiptFile(userId: string, expenseId: string, file: File): Promise<string> {
  const safeName = file.name.replace(/[^a-zA-Z0-9.\-_]+/g, '_');
  const path = `${userId}/${expenseId}/${Date.now()}-${safeName}`;

  const { error } = await supabase.storage.from('receipts').upload(path, file, {
    contentType: file.type || 'application/octet-stream',
    upsert: false,
  });

  if (error) {
    console.error('Failed to upload receipt file', error);
    throw error;
  }

  return path;
}

async function removeReceiptFile(storagePath?: string) {
  if (!storagePath) return;
  const { error } = await supabase.storage.from('receipts').remove([storagePath]);
  if (error) {
    // Not fatal - the DB row is still the source of truth for the UI.
    // Worst case an orphaned file sits in storage.
    console.error('Failed to delete receipt file from storage', error);
  }
}

// Resolves a viewable URL for a receipt: the in-tab blob if this is the same
// session it was uploaded in, otherwise a short-lived signed URL from
// Storage. Returns undefined if neither is available (pre-Storage receipt
// that needs to be re-uploaded).
export async function getReceiptViewUrl(receipt: ExpenseReceipt): Promise<string | undefined> {
  if (receipt.objectUrl) {
    return receipt.objectUrl;
  }
  if (!receipt.storagePath) {
    return undefined;
  }

  const { data, error } = await supabase.storage.from('receipts').createSignedUrl(receipt.storagePath, 60);
  if (error || !data) {
    console.error('Failed to create signed receipt URL', error);
    return undefined;
  }
  return data.signedUrl;
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
    storagePath: receiptInput?.storagePath,
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
  const previousStoragePath = expense.receipt.storagePath;

  const receipt: ExpenseReceipt = {
    ...expense.receipt,
    name: receiptInput.name,
    type: receiptInput.type,
    size: receiptInput.size,
    objectUrl: receiptInput.objectUrl,
    storagePath: receiptInput.storagePath,
  };

  await upsertReceipt(expenseId, receipt);
  if (previousStoragePath && previousStoragePath !== receipt.storagePath) {
    await removeReceiptFile(previousStoragePath);
  }

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
  await removeReceiptFile(expense.receipt.storagePath);

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
