import { useSyncExternalStore } from 'react';
import { addActivity } from './activityStore';
import { getCurrentUserId } from './authStore';
import { supabase } from '@/lib/supabase';

export type Customer = {
  id: string;
  name: string;
  contact: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
};

type CustomerRow = {
  id: string;
  name: string;
  contact: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
};

function rowToCustomer(row: CustomerRow): Customer {
  return {
    id: row.id,
    name: row.name,
    contact: row.contact ?? '',
    phone: row.phone ?? '',
    email: row.email ?? '',
    address: row.address ?? '',
    notes: row.notes ?? '',
  };
}

let customersSnapshot: Customer[] = [];
const listeners = new Set<() => void>();

function emitChange() {
  listeners.forEach((listener) => listener());
}

// Called by src/data/bootstrap.ts whenever the signed-in user changes -
// loads that user's customers from Supabase into the in-memory snapshot
// this store's hook reads from.
export async function loadCustomers(userId: string) {
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Failed to load customers', error);
    return;
  }

  customersSnapshot = (data ?? []).map(rowToCustomer);
  emitChange();
}

// Called on sign-out so the previous user's data doesn't linger on screen
// for whoever looks at the app next.
export function clearCustomers() {
  customersSnapshot = [];
  emitChange();
}

export async function saveCustomer(customer: Customer, originalId?: string) {
  const userId = getCurrentUserId();
  if (!userId) {
    throw new Error('You must be signed in to save a customer.');
  }

  const lookupId = originalId ?? customer.id;
  const isExisting = customersSnapshot.some((item) => item.id === lookupId);

  const { error } = await supabase.from('customers').upsert({
    id: customer.id,
    user_id: userId,
    name: customer.name,
    contact: customer.contact,
    phone: customer.phone,
    email: customer.email,
    address: customer.address,
    notes: customer.notes,
    updated_at: new Date().toISOString(),
  });

  if (error) {
    console.error('Failed to save customer', error);
    throw error;
  }

  if (isExisting) {
    customersSnapshot = customersSnapshot.map((item) => (item.id === lookupId ? customer : item));
    addActivity(`Customer updated: ${customer.name}`);
  } else {
    customersSnapshot = [customer, ...customersSnapshot];
    addActivity(`Customer created: ${customer.name}`);
  }

  emitChange();
}

export function useCustomers() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => customersSnapshot,
    () => customersSnapshot
  );
}
