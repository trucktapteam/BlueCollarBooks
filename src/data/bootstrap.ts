// Wires the auth state to every data store: when a user signs in, load
// their rows from Supabase into each store's in-memory snapshot; when they
// sign out, clear those snapshots so the next person to open the app (or
// this same person signing back in) doesn't briefly see stale data.
//
// Imported once, for its side effect, from the root layout - see
// src/app/_layout.tsx. Nothing else needs to import this file.
import { onAuthChange } from './authStore';
import { clearActivities, loadActivities } from './activityStore';
import { clearBankAccounts, loadBankAccounts } from './mockBankAccounts';
import { clearBusinessProfile, loadBusinessProfile } from './mockBusiness';
import { clearCategories, loadCategories } from './mockCategories';
import { clearCustomers, loadCustomers } from './mockCustomers';
import { clearExpenses, loadExpenses } from './mockExpenses';
import { clearInvoices, loadInvoices } from './mockInvoices';
import { clearPlaidTransactions, loadPlaidTransactions } from './mockPlaidTransactions';
import { clearSubscription, loadSubscription } from './subscriptionStore';

let lastLoadedUserId: string | null = null;

onAuthChange((session) => {
  const userId = session?.user.id ?? null;
  if (userId === lastLoadedUserId) {
    return;
  }
  lastLoadedUserId = userId;

  if (!userId) {
    clearCustomers();
    clearInvoices();
    clearExpenses();
    clearBankAccounts();
    clearBusinessProfile();
    clearActivities();
    clearSubscription();
    clearPlaidTransactions();
    clearCategories();
    return;
  }

  loadCustomers(userId);
  loadInvoices(userId);
  loadExpenses(userId);
  loadBankAccounts(userId);
  loadBusinessProfile(userId);
  loadActivities(userId);
  loadSubscription(userId);
  loadPlaidTransactions(userId);
  loadCategories(userId);
});
