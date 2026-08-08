import { useSyncExternalStore } from 'react';
import { loadPersistedData, persistData } from './persistentStore';

export type BusinessSettings = {
  businessName: string;
  contactName?: string;
  address?: string;
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
  phone?: string;
  email?: string;
  website?: string;
  defaultPaymentTerms?: string;
  invoiceNotes?: string;
  paymentInstructions?: string;
  startingInvoiceNumber?: string;
  // persisted as data URL when uploaded from browser
  logoDataUrl?: string | null;
};

const LOCAL_STORAGE_KEY = 'bluecollarbooks_business';

const defaultSettings: BusinessSettings & { logoModule: any } = {
  businessName: 'Blue Collar Books',
  contactName: undefined,
  address: 'Address',
  street: 'Address',
  city: '',
  state: '',
  zip: '',
  phone: '(555) 123-4567',
  email: 'billing@bluecollarbooks.com',
  website: undefined,
  defaultPaymentTerms: 'Net 30',
  invoiceNotes: 'Thank you for your business.',
  paymentInstructions: '',
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
    street: snapshot.street,
    city: snapshot.city,
    state: snapshot.state,
    zip: snapshot.zip,
    phone: snapshot.phone,
    email: snapshot.email,
    website: snapshot.website,
    defaultPaymentTerms: snapshot.defaultPaymentTerms,
    invoiceNotes: snapshot.invoiceNotes,
    paymentInstructions: snapshot.paymentInstructions,
    startingInvoiceNumber: snapshot.startingInvoiceNumber,
    logoDataUrl: snapshot.logoDataUrl ?? null,
  };

  persistData(LOCAL_STORAGE_KEY, toPersist);
  emitChange();
}

export function formatBusinessAddress(profile: BusinessSettings) {
  const cityLine = [profile.city, profile.state, profile.zip].filter(Boolean).join(' ');
  const structuredAddress = [profile.street, cityLine].filter(Boolean).join('<br />');
  return structuredAddress || profile.address || '';
}

// Cents, like every other money value in the app (see src/utils/money.ts).
export const startingCashBalanceCents = 785000;
