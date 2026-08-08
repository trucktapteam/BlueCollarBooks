import { useSyncExternalStore } from 'react';
import { addActivity } from './activityStore';
import { loadPersistedData, persistData } from './persistentStore';
import { generateId } from '@/utils/id';

export type Customer = {
  id: string;
  name: string;
  contact: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
};

const initialCustomers: Customer[] = [
  {
    id: 'seed-independent-steel',
    name: 'Independent Steel',
    contact: 'Mason Clarke',
    phone: '(502) 555-0148',
    email: 'dispatch@independentsteel.example',
    address: '1400 River Road, Louisville, KY',
    notes: 'Flatbed steel loads. Usually pays on Net 30.',
  },
  {
    id: 'seed-louisville-dryer',
    name: 'Louisville Dryer',
    contact: 'Dana Whitaker',
    phone: '(502) 555-0192',
    email: 'ap@louisvilledryer.example',
    address: '88 Industrial Parkway, Louisville, KY',
    notes: 'Repair equipment freight and rush shipments.',
  },
  {
    id: 'seed-abc-steel',
    name: 'ABC Steel',
    contact: 'Riley Brooks',
    phone: '(812) 555-0175',
    email: 'billing@abcsteel.example',
    address: '240 Foundry Lane, Jeffersonville, IN',
    notes: 'Smaller recurring steel runs.',
  },
];

const LOCAL_STORAGE_KEY = 'bluecollarbooks_customers';

// Backfills a stable id for any customer record saved before ids existed.
// Without this, every customer created prior to this change would have no
// id and would break the by-id lookups below on first load.
function migrateCustomer(customer: Customer): Customer {
  return customer.id ? customer : { ...customer, id: generateId() };
}

let customersSnapshot = loadPersistedData<Customer[]>(LOCAL_STORAGE_KEY, initialCustomers).map(migrateCustomer);
const listeners = new Set<() => void>();

// Persist immediately so backfilled ids are written to storage once, not
// regenerated (and thus changed) on every subsequent load.
persistData(LOCAL_STORAGE_KEY, customersSnapshot);

function emitChange() {
  listeners.forEach((listener) => listener());
}

export function saveCustomer(customer: Customer, originalId?: string) {
  const lookupId = originalId ?? customer.id;
  const existingCustomerIndex = customersSnapshot.findIndex((item) => item.id === lookupId);

  if (existingCustomerIndex >= 0) {
    customersSnapshot = customersSnapshot.map((item, index) =>
      index === existingCustomerIndex ? customer : item
    );
    addActivity(`Customer updated: ${customer.name}`);
  } else {
    customersSnapshot = [customer, ...customersSnapshot];
    addActivity(`Customer created: ${customer.name}`);
  }

  persistData(LOCAL_STORAGE_KEY, customersSnapshot);
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
