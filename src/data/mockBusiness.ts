import { useSyncExternalStore } from 'react';
import { getCurrentUserId } from './authStore';
import { supabase } from '@/lib/supabase';

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

type BusinessSettingsRow = {
  business_name: string;
  contact_name: string | null;
  address: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  default_payment_terms: string | null;
  invoice_notes: string | null;
  payment_instructions: string | null;
  starting_invoice_number: string | null;
  logo_data_url: string | null;
};

function rowToSettings(row: BusinessSettingsRow): BusinessSettings {
  return {
    businessName: row.business_name,
    contactName: row.contact_name ?? undefined,
    address: row.address ?? undefined,
    street: row.street ?? undefined,
    city: row.city ?? undefined,
    state: row.state ?? undefined,
    zip: row.zip ?? undefined,
    phone: row.phone ?? undefined,
    email: row.email ?? undefined,
    website: row.website ?? undefined,
    defaultPaymentTerms: row.default_payment_terms ?? undefined,
    invoiceNotes: row.invoice_notes ?? undefined,
    paymentInstructions: row.payment_instructions ?? undefined,
    startingInvoiceNumber: row.starting_invoice_number ?? undefined,
    logoDataUrl: row.logo_data_url,
  };
}

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

let snapshot: BusinessSettings & { logoModule?: any } = { ...defaultSettings };
const listeners = new Set<() => void>();

function emitChange() {
  listeners.forEach((listener) => listener());
}

export async function loadBusinessProfile(userId: string) {
  const { data, error } = await supabase.from('business_settings').select('*').eq('user_id', userId).maybeSingle();

  if (error) {
    console.error('Failed to load business settings', error);
    return;
  }

  snapshot = data ? { ...defaultSettings, ...rowToSettings(data) } : { ...defaultSettings };
  emitChange();
}

export function clearBusinessProfile() {
  snapshot = { ...defaultSettings };
  emitChange();
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

export async function saveBusinessProfile(updates: Partial<BusinessSettings & { logoModule?: any }>) {
  const userId = getCurrentUserId();
  if (!userId) {
    throw new Error('You must be signed in to save business settings.');
  }

  snapshot = { ...snapshot, ...updates };
  emitChange();

  const { error } = await supabase.from('business_settings').upsert({
    user_id: userId,
    business_name: snapshot.businessName,
    contact_name: snapshot.contactName,
    address: snapshot.address,
    street: snapshot.street,
    city: snapshot.city,
    state: snapshot.state,
    zip: snapshot.zip,
    phone: snapshot.phone,
    email: snapshot.email,
    website: snapshot.website,
    default_payment_terms: snapshot.defaultPaymentTerms,
    invoice_notes: snapshot.invoiceNotes,
    payment_instructions: snapshot.paymentInstructions,
    starting_invoice_number: snapshot.startingInvoiceNumber,
    logo_data_url: snapshot.logoDataUrl ?? null,
    updated_at: new Date().toISOString(),
  });

  if (error) {
    console.error('Failed to save business settings', error);
    throw error;
  }
}

export function formatBusinessAddress(profile: BusinessSettings) {
  const cityLine = [profile.city, profile.state, profile.zip].filter(Boolean).join(' ');
  const structuredAddress = [profile.street, cityLine].filter(Boolean).join('<br />');
  return structuredAddress || profile.address || '';
}
