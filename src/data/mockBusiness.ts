import { useSyncExternalStore } from 'react';
import { loadPersistedData, persistData } from './persistentStore';

export type BusinessSettings = {
  businessName: string;
  contactName?: string;
  address?: string;
  phone?: string;
  email?: string;
  website?: string;
  defaultPaymentTerms?: string;
  startingInvoiceNumber?: string;
  // persisted as data URL when uploaded from browser
  logoDataUrl?: string | null;
};

const LOCAL_STORAGE_KEY = 'bluecollarbooks_business';

const defaultSettings: BusinessSettings & { logoModule: any } = {
  businessName: 'Blue Collar Books',
  contactName: undefined,
  address: 'Address',
  phone: '(555) 123-4567',
  email: 'billing@bluecollarbooks.com',
  website: undefined,
  defaultPaymentTerms: 'Net 30',
  startingInvoiceNumber: '1000',
  logoDataUrl: null,
  logoModule: require('@/assets/images/blue-collar-books-logo.jpg'),
};

let snapshot: BusinessSettings & { logoModule?: any } = {
  ...defaultSettings,
  ...loadPersistedData<Partial<BusinessSettings>>(LOCAL_STORAGE_KEY, {}),
};

const listeners = new Set<() => void>();

function emitChange() {
  listeners.forEach((l) => l());
}

export function useBusinessProfile() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => snapshot,
    () => snapshot
  );
}

export function saveBusinessProfile(updates: Partial<BusinessSettings & { logoModule?: any }>) {
  snapshot = { ...snapshot, ...updates };
  // persist only serializable fields
  const toPersist: BusinessSettings = {
    businessName: snapshot.businessName,
    contactName: snapshot.contactName,
    address: snapshot.address,
    phone: snapshot.phone,
    email: snapshot.email,
    website: snapshot.website,
    defaultPaymentTerms: snapshot.defaultPaymentTerms,
    startingInvoiceNumber: snapshot.startingInvoiceNumber,
    logoDataUrl: snapshot.logoDataUrl ?? null,
  };

  persistData(LOCAL_STORAGE_KEY, toPersist);
  emitChange();
}

export const startingCashBalance = 7850;

