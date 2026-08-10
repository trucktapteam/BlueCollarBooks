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

// Corrects a specific over-conversion bug: during development, this file was
// hot-reloaded while the dollars-to-cents migration above was mid-rollout,
// which let it run twice against the same stored balance for at least one
// browser session - leaving Business Checking/Savings 100x too large
// ($785,000 instead of $7,850, etc). This is a one-time, exact fix, not a
// heuristic: it only touches an account whose stored balance is precisely
// 100x that account's known seed balance, so it can't misfire on a
// legitimately large balance.
const CENTS_FIX_VERSION_KEY = 'bluecollarbooks_bank_accounts_money_fix_v';
const centsFixVersion = loadPersistedData<number>(CENTS_FIX_VERSION_KEY, 0);

function fixDoubleConvertedBalance(account: BankAccount): BankAccount {
  if (centsFixVersion >= 1) return account;
  const seed = initialBankAccounts.find((seedAccount) => seedAccount.id === account.id);
  if (seed && account.balance === seed.balance * 100) {
    return { ...account, balance: seed.balance };
  }
  return account;
}

let bankAccountsSnapshot = loadPersistedData<BankAccount[]>(LOCAL_STORAGE_KEY, initialBankAccounts)
  .map(migrateBankAccountMoney)
  .map(fixDoubleConvertedBalance);
if (moneyVersion < 1) {
  persistData(MONEY_VERSION_KEY, 1);
}
if (centsFixVersion < 1) {
  persistData(CENTS_FIX_VERSION_KEY, 1);
}
persistData(LOCAL_STORAGE_KEY, bankAccountsSnapshot);
const listeners = new Set<() => void>();

function emitChange() {
  listeners.forEach((listener) => listener());
}

export function saveBankAccounts(accounts: BankAccount[]) {
  bankAccountsSnapshot = accounts;
  persistData(LOCAL_STORAGE_KEY, bankAccountsSnapshot);
  emitChange();
}

// Total cash across every bank account, in cents. Used as the baseline for
// the Dashboard's "Cash Available" figure - see src/app/index.tsx. Previously
// that figure came from a hardcoded constant equal to only the Checking
// balance, so Savings was silently left out of a number the business relies
// on to know how much cash it actually has.
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
