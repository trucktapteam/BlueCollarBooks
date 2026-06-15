import { useSyncExternalStore } from 'react';
import { addActivity } from './activityStore';
import { loadPersistedData, persistData } from './persistentStore';

export type Expense = {
  id?: string;
  date: string;
  vendor: string;
  category: string;
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

function generateId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const initialExpenses: Expense[] = [
  { date: '06/09/2026', vendor: 'Loves Travel Stop', category: 'Fuel', amount: 324, notes: 'Diesel fill-up' },
  { date: '06/08/2026', vendor: 'NAPA Auto Parts', category: 'Repairs', amount: 89, notes: 'Replacement parts' },
  { date: '06/07/2026', vendor: 'Supabase', category: 'Software', amount: 25, notes: 'Monthly tools' },
  { date: '06/06/2026', vendor: 'Google Play', category: 'Software', amount: 25, notes: 'App publishing' },
];

const LOCAL_STORAGE_KEY = 'bluecollarbooks_expenses';
let expensesSnapshot = loadPersistedData<Expense[]>(LOCAL_STORAGE_KEY, initialExpenses).map((expense) =>
  sanitizeExpenseForPersistence({
    ...expense,
    id: expense.id ?? generateId(),
  })
);
const listeners = new Set<() => void>();

function emitChange() {
  listeners.forEach((listener) => listener());
}

function sanitizeExpenseForPersistence(expense: Expense): Expense {
  if (!expense.receipt) {
    return expense;
  }

  const { objectUrl, ...receipt } = expense.receipt;
  return { ...expense, receipt };
}

function persistExpenses() {
  persistData(LOCAL_STORAGE_KEY, expensesSnapshot.map(sanitizeExpenseForPersistence));
}

persistExpenses();

export function addExpense(expense: Expense) {
  saveExpense({ ...expense, id: expense.id ?? generateId() });
}

export function saveExpense(expense: Expense, originalId?: string) {
  const lookupId = originalId ?? expense.id;
  const existingExpenseIndex = expensesSnapshot.findIndex((item) => item.id === lookupId);
  const existingExpense = existingExpenseIndex >= 0 ? expensesSnapshot[existingExpenseIndex] : undefined;
  const expenseToSave = {
    ...expense,
    id: lookupId ?? generateId(),
    receipt: expense.receipt ?? existingExpense?.receipt,
  };

  if (existingExpenseIndex >= 0) {
    expensesSnapshot = expensesSnapshot.map((item, index) =>
      index === existingExpenseIndex ? expenseToSave : item
    );
    addActivity(`Expense updated: ${expenseToSave.vendor} $${expenseToSave.amount}`);
  } else {
    expensesSnapshot = [expenseToSave, ...expensesSnapshot];
    addActivity(`Expense added: ${expenseToSave.vendor} $${expenseToSave.amount}`);
  }

  persistExpenses();
  emitChange();
}

export function attachExpenseReceipt(expenseId: string, receiptInput?: ExpenseReceiptInput) {
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

  expensesSnapshot = expensesSnapshot.map((item) =>
    item.id === expenseId ? { ...item, receipt } : item
  );

  persistExpenses();
  addActivity(`Receipt attached: ${expense.vendor} ${receipt.name}`);
  emitChange();
}

export function reattachExpenseReceipt(expenseId: string, receiptInput: ExpenseReceiptInput) {
  const expense = expensesSnapshot.find((item) => item.id === expenseId);

  if (!expense?.receipt) {
    return;
  }

  if (typeof URL !== 'undefined' && expense.receipt.objectUrl?.startsWith('blob:')) {
    URL.revokeObjectURL(expense.receipt.objectUrl);
  }

  expensesSnapshot = expensesSnapshot.map((item) =>
    item.id === expenseId
      ? {
          ...item,
          receipt: {
            ...item.receipt,
            id: item.receipt?.id ?? generateId(),
            name: receiptInput.name,
            type: receiptInput.type,
            dateAdded: item.receipt?.dateAdded ?? new Date().toISOString(),
            size: receiptInput.size,
            objectUrl: receiptInput.objectUrl,
          },
        }
      : item
  );

  persistExpenses();
  addActivity(`Receipt reattached: ${expense.vendor} ${receiptInput.name}`);
  emitChange();
}

export function deleteExpenseReceipt(expenseId: string) {
  const expense = expensesSnapshot.find((item) => item.id === expenseId);

  if (!expense?.receipt) {
    return;
  }

  if (typeof URL !== 'undefined' && expense.receipt.objectUrl?.startsWith('blob:')) {
    URL.revokeObjectURL(expense.receipt.objectUrl);
  }

  expensesSnapshot = expensesSnapshot.map((item) =>
    item.id === expenseId ? { ...item, receipt: undefined } : item
  );

  persistExpenses();
  addActivity(`Receipt deleted: ${expense.vendor} ${expense.receipt.name}`);
  emitChange();
}

export function calculateTotalMonthlyExpenses(expenses: Expense[]) {
  return expenses.reduce((total, expense) => total + expense.amount, 0);
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
