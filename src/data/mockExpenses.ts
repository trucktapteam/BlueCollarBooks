import { useSyncExternalStore } from 'react';
import { addActivity } from './activityStore';
import { isSameMonth } from './mockInvoices';
import { loadPersistedData, persistData } from './persistentStore';
import { generateId } from '@/utils/id';
import { dollarsToCents, formatMoneyCents } from '@/utils/money';
import { normalizeDateToISO } from '@/utils/date';

export type Expense = {
  id?: string;
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

const initialExpenses: Expense[] = [
  { date: '06/09/2026', vendor: 'Loves Travel Stop', category: 'Fuel', amount: 32400, notes: 'Diesel fill-up' },
  { date: '06/08/2026', vendor: 'NAPA Auto Parts', category: 'Repairs', amount: 8900, notes: 'Replacement parts' },
  { date: '06/07/2026', vendor: 'Supabase', category: 'Software', amount: 2500, notes: 'Monthly tools' },
  { date: '06/06/2026', vendor: 'Google Play', category: 'Software', amount: 2500, notes: 'App publishing' },
];

const LOCAL_STORAGE_KEY = 'bluecollarbooks_expenses';
// One-time flag so existing local amounts (stored as whole dollars) get
// multiplied into cents exactly once, instead of being reinterpreted as
// cents (which would silently divide every expense by 100).
const MONEY_VERSION_KEY = 'bluecollarbooks_expenses_money_v';
const moneyVersion = loadPersistedData<number>(MONEY_VERSION_KEY, 0);

function migrateExpenseMoney(expense: Expense): Expense {
  return moneyVersion >= 1 ? expense : { ...expense, amount: dollarsToCents(expense.amount) };
}

// One-time flag so existing local dates (stored in mixed "MM/DD/YYYY" /
// other formats) get normalized to ISO 'YYYY-MM-DD' exactly once.
const DATE_VERSION_KEY = 'bluecollarbooks_expenses_date_v';
const dateVersion = loadPersistedData<number>(DATE_VERSION_KEY, 0);

function migrateExpenseDate(expense: Expense): Expense {
  return dateVersion >= 1 ? expense : { ...expense, date: normalizeDateToISO(expense.date) };
}

let expensesSnapshot = loadPersistedData<Expense[]>(LOCAL_STORAGE_KEY, initialExpenses).map((expense) =>
  sanitizeExpenseForPersistence(
    migrateExpenseDate(
      migrateExpenseMoney({
        ...expense,
        id: expense.id ?? generateId(),
      })
    )
  )
);
if (moneyVersion < 1) {
  persistData(MONEY_VERSION_KEY, 1);
}
if (dateVersion < 1) {
  persistData(DATE_VERSION_KEY, 1);
}
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
    addActivity(`Expense updated: ${expenseToSave.vendor} ${formatMoneyCents(expenseToSave.amount)}`);
  } else {
    expensesSnapshot = [expenseToSave, ...expensesSnapshot];
    addActivity(`Expense added: ${expenseToSave.vendor} ${formatMoneyCents(expenseToSave.amount)}`);
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
