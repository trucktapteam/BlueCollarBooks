import { useSyncExternalStore } from 'react';
import { loadPersistedData, persistData } from './persistentStore';
import { dollarsToCents } from '@/utils/money';

export type BankAccount = {
  id: string;
  name: string;
  last4: string;
  // Cents, like every other money value in the app (see src/utils/money.ts).
  balance: number;
  lastUpdated: string;
};

const initialBankAccounts: BankAccount[] = [
  {
    id: 'business-checking',
    name: 'Business Checking',
    last4: '4821',
    balance: 785000,
    lastUpdated: 'Jun 14, 2026 9:15 AM',
  },
  {
    id: 'business-savings',
    name: 'Business Savings',
    last4: '1198',
    balance: 1250000,
    lastUpdated: 'Jun 13, 2026 4:30 PM',
  },
];

const LOCAL_STORAGE_KEY = 'bluecollarbooks_bank_accounts';
// One-time flag so existing local balances (stored as whole dollars) get
// multiplied into cents exactly once, instead of being reinterpreted as
// cents (which would silently divide every balance by 100).
const MONEY_VERSION_KEY = 'bluecollarbooks_bank_accounts_money_v';
const moneyVersion = loadPersistedData<number>(MONEY_VERSION_KEY, 0);

function migrateBankAccountMoney(account: BankAccount): BankAccount {
  if (moneyVersion >= 1) return account;
  return { ...account, balance: dollarsToCents(account.balance) };
}

let bankAccountsSnapshot = loadPersistedData<BankAccount[]>(LOCAL_STORAGE_KEY, initialBankAccounts).map(
  migrateBankAccountMoney
);
if (moneyVersion < 1) {
  persistData(MONEY_VERSION_KEY, 1);
  persistData(LOCAL_STORAGE_KEY, bankAccountsSnapshot);
}
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
