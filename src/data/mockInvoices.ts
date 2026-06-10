import { useSyncExternalStore } from 'react';
import { loadPersistedData, persistData } from './persistentStore';

export type InvoiceStatus = 'Draft' | 'Sent' | 'Overdue' | 'Paid';

export type Invoice = {
  invoice: string;
  customer: string;
  amount: string;
  status: InvoiceStatus;
  invoiceDate: string;
};

export type InvoiceLineItem = {
  description: string;
  amount: string;
};

export const invoiceStatuses: InvoiceStatus[] = ['Draft', 'Sent', 'Paid', 'Overdue'];

export const invoiceLabels = {
  description: 'Freight Description',
  shipper: 'Shipper Address',
  consignee: 'Consignee Address',
  bol: 'BOL Number',
  po: 'PO Number',
};

export const invoiceDraft = {
  number: '26032',
  date: '06/09/2026',
  terms: 'Net 30',
  customer: 'Independent Steel',
  poNumber: 'PO-44321',
  bolNumber: 'BOL-99812',
  shipper: 'Address',
  consignee: 'Address',
  freightDescription: 'Steel Beams',
  total: '$625',
};

export const invoiceLineItems = [{ description: 'Flatbed Freight', amount: '$625' }];

const initialInvoices: Invoice[] = [
  {
    invoice: '26031',
    customer: 'Independent Steel',
    amount: '$625',
    status: 'Sent',
    invoiceDate: 'Apr 1, 2026',
  },
  {
    invoice: '26028',
    customer: 'Louisville Dryer',
    amount: '$850',
    status: 'Overdue',
    invoiceDate: 'Mar 18, 2026',
  },
  {
    invoice: '26027',
    customer: 'ABC Steel',
    amount: '$275',
    status: 'Paid',
    invoiceDate: 'Apr 10, 2026',
  },
];

const LOCAL_STORAGE_KEY = 'bluecollarbooks_invoices';
let invoicesSnapshot = loadPersistedData<Invoice[]>(LOCAL_STORAGE_KEY, initialInvoices);
const listeners = new Set<() => void>();

function emitChange() {
  listeners.forEach((listener) => listener());
}

export function parseInvoiceAmount(amount: string) {
  const parsedAmount = Number(amount.replace(/[$,]/g, '').trim());
  return Number.isFinite(parsedAmount) ? parsedAmount : 0;
}

export function formatInvoiceAmount(amount: number) {
  return `$${amount.toLocaleString()}`;
}

export function saveInvoice(invoice: Invoice) {
  const existingInvoiceIndex = invoicesSnapshot.findIndex((item) => item.invoice === invoice.invoice);

  if (existingInvoiceIndex >= 0) {
    invoicesSnapshot = invoicesSnapshot.map((item, index) => (index === existingInvoiceIndex ? invoice : item));
  } else {
    invoicesSnapshot = [invoice, ...invoicesSnapshot];
  }

  persistData(LOCAL_STORAGE_KEY, invoicesSnapshot);
  emitChange();
}

export function updateInvoiceStatus(invoiceNumber: string, status: InvoiceStatus) {
  invoicesSnapshot = invoicesSnapshot.map((invoice) =>
    invoice.invoice === invoiceNumber ? { ...invoice, status } : invoice
  );
  persistData(LOCAL_STORAGE_KEY, invoicesSnapshot);
  emitChange();
}

export function calculateInvoiceTotal(invoices: Invoice[]) {
  return invoices.reduce((total, invoice) => total + parseInvoiceAmount(invoice.amount), 0);
}

export function isInvoiceWaitingToBePaid(invoice: Invoice) {
  return invoice.status === 'Sent' || invoice.status === 'Overdue';
}

export function calculateWaitingToBePaidTotal(invoices: Invoice[]) {
  return calculateInvoiceTotal(invoices.filter(isInvoiceWaitingToBePaid));
}

export function calculatePaidInvoiceTotal(invoices: Invoice[]) {
  return calculateInvoiceTotal(invoices.filter((invoice) => invoice.status === 'Paid'));
}

export function useInvoices() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => invoicesSnapshot,
    () => invoicesSnapshot
  );
}
