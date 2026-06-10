import { useSyncExternalStore } from 'react';

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
    status: 'Draft',
    invoiceDate: 'Apr 10, 2026',
  },
];

let invoicesSnapshot = initialInvoices;
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

  emitChange();
}

export function calculateInvoiceTotal(invoices: Invoice[]) {
  return invoices.reduce((total, invoice) => total + parseInvoiceAmount(invoice.amount), 0);
}

export function isInvoiceUnpaid(invoice: Invoice) {
  return invoice.status !== 'Paid';
}

export function calculateUnpaidInvoiceTotal(invoices: Invoice[]) {
  return calculateInvoiceTotal(invoices.filter(isInvoiceUnpaid));
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
