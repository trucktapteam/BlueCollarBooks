import { useSyncExternalStore } from 'react';
import { loadPersistedData, persistData } from './persistentStore';

export type BankAccount = {
  id: string;
  name: string;
  last4: string;
  balance: number;
  lastUpdated: string;
};

const initialBankAccounts: BankAccount[] = [
  {
    id: 'business-checking',
    name: 'Business Checking',
    last4: '4821',
    balance: 7850,
    lastUpdated: 'Jun 14, 2026 9:15 AM',
  },
  {
    id: 'business-savings',
    name: 'Business Savings',
    last4: '1198',
    balance: 12500,
    lastUpdated: 'Jun 13, 2026 4:30 PM',
  },
];

const LOCAL_STORAGE_KEY = 'bluecollarbooks_bank_accounts';
let bankAccountsSnapshot = loadPersistedData<BankAccount[]>(LOCAL_STORAGE_KEY, initialBankAccounts);
const listeners = new Set<() => void>();

function emitChange() {
  listeners.forEach((listener) => listener());
}

export function saveBankAccounts(accounts: BankAccount[]) {
  bankAccountsSnapshot = accounts;
  persistData(LOCAL_STORAGE_KEY, bankAccountsSnapshot);
  emitChange();
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
