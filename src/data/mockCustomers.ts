import { useSyncExternalStore } from 'react';
import { addActivity } from './activityStore';
import { loadPersistedData, persistData } from './persistentStore';

export type Customer = {
  name: string;
  contact: string;
  phone: string;
  email: string;
  address: string;
  notes: string;
};

const initialCustomers: Customer[] = [
  {
    name: 'Independent Steel',
    contact: 'Mason Clarke',
    phone: '(502) 555-0148',
    email: 'dispatch@independentsteel.example',
    address: '1400 River Road, Louisville, KY',
    notes: 'Flatbed steel loads. Usually pays on Net 30.',
  },
  {
    name: 'Louisville Dryer',
    contact: 'Dana Whitaker',
    phone: '(502) 555-0192',
    email: 'ap@louisvilledryer.example',
    address: '88 Industrial Parkway, Louisville, KY',
    notes: 'Repair equipment freight and rush shipments.',
  },
  {
    name: 'ABC Steel',
    contact: 'Riley Brooks',
    phone: '(812) 555-0175',
    email: 'billing@abcsteel.example',
    address: '240 Foundry Lane, Jeffersonville, IN',
    notes: 'Smaller recurring steel runs.',
  },
];

const LOCAL_STORAGE_KEY = 'bluecollarbooks_customers';
let customersSnapshot = loadPersistedData<Customer[]>(LOCAL_STORAGE_KEY, initialCustomers);
const listeners = new Set<() => void>();

function emitChange() {
  listeners.forEach((listener) => listener());
}

export function saveCustomer(customer: Customer, originalName?: string) {
  const lookupName = originalName ?? customer.name;
  const existingCustomerIndex = customersSnapshot.findIndex((item) => item.name === lookupName);

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
