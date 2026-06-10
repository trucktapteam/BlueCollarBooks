import { useSyncExternalStore } from 'react';
import { loadPersistedData, persistData } from './persistentStore';

export type Expense = {
  date: string;
  vendor: string;
  category: string;
  amount: number;
  notes: string;
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

const initialExpenses: Expense[] = [
  { date: '06/09/2026', vendor: 'Loves Travel Stop', category: 'Fuel', amount: 324, notes: 'Diesel fill-up' },
  { date: '06/08/2026', vendor: 'NAPA Auto Parts', category: 'Repairs', amount: 89, notes: 'Replacement parts' },
  { date: '06/07/2026', vendor: 'Supabase', category: 'Software', amount: 25, notes: 'Monthly tools' },
  { date: '06/06/2026', vendor: 'Google Play', category: 'Software', amount: 25, notes: 'App publishing' },
];

const LOCAL_STORAGE_KEY = 'bluecollarbooks_expenses';
let expensesSnapshot = loadPersistedData<Expense[]>(LOCAL_STORAGE_KEY, initialExpenses);
const listeners = new Set<() => void>();

function emitChange() {
  listeners.forEach((listener) => listener());
}

export function addExpense(expense: Expense) {
  expensesSnapshot = [expense, ...expensesSnapshot];
  persistData(LOCAL_STORAGE_KEY, expensesSnapshot);
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
