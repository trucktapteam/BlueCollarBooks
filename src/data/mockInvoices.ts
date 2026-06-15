import { useSyncExternalStore } from 'react';
import { addActivity } from './activityStore';
import { loadPersistedData, persistData } from './persistentStore';

export type InvoiceStatus = 'Draft' | 'Sent' | 'Due Today' | 'Overdue' | 'Paid';

export type Invoice = {
  invoice: string;
  customer: string;
  amount: string;
  status: InvoiceStatus;
  invoiceDate: string;
  terms?: string;
  poNumber?: string;
  bolNumber?: string;
  shipper?: string;
  consignee?: string;
  freightDescription?: string;
  lineItems?: InvoiceLineItem[];
  payments?: InvoicePayment[];
};

export type InvoiceLineItem = {
  description: string;
  amount: string;
};

export type InvoicePayment = {
  id: string;
  amount: number;
  date: string;
  notes?: string;
};

export type ReceiveInvoicePaymentInput = {
  amount: number;
  date: string;
  notes?: string;
};

export const invoiceStatuses: InvoiceStatus[] = ['Draft', 'Sent', 'Due Today', 'Paid', 'Overdue'];

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

function generateId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function parseTermsToDays(terms?: string) {
  if (!terms) return 0;
  const m = terms.match(/(\d+)/);
  if (m) return Number(m[1]);
  return 0;
}

function parseDateStringToDate(d?: string) {
  if (!d) return null;
  const parsed = Date.parse(d);
  if (!isNaN(parsed)) return new Date(parsed);
  // try MM/DD/YYYY
  const parts = d.split('/').map((p) => Number(p));
  if (parts.length === 3) {
    const [m, day, y] = parts;
    return new Date(y, m - 1, day);
  }
  return null;
}

function formatDateShort(date: Date) {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function computeDueDate(invoice: Invoice) {
  const invoiceDt = parseDateStringToDate(invoice.invoiceDate);
  if (!invoiceDt) return undefined;
  const days = parseTermsToDays(invoice.terms);
  const due = new Date(invoiceDt.getTime());
  due.setDate(due.getDate() + days);
  return due;
}

function refreshInvoiceStatuses() {
  const now = new Date();
  invoicesSnapshot = invoicesSnapshot.map((inv) => {
    if (inv.status === 'Paid' || inv.status === 'Draft') return inv;

    const due = computeDueDate(inv);
    if (!due) return { ...inv, status: 'Sent' };

    const dueDateOnly = new Date(due.getFullYear(), due.getMonth(), due.getDate());
    const todayOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    if (dueDateOnly.getTime() === todayOnly.getTime()) {
      return { ...inv, status: 'Due Today' };
    }

    if (dueDateOnly.getTime() < todayOnly.getTime()) {
      return { ...inv, status: 'Overdue' };
    }

    return { ...inv, status: 'Sent' };
  });
}

export function parseInvoiceAmount(amount: string) {
  const parsedAmount = Number(amount.replace(/[$,]/g, '').trim());
  return Number.isFinite(parsedAmount) ? parsedAmount : 0;
}

export function formatInvoiceAmount(amount: number) {
  return amount.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

function isSameMonth(dateString: string, comparisonDate: Date) {
  const parsed = parseDateStringToDate(dateString);
  return (
    !!parsed &&
    parsed.getFullYear() === comparisonDate.getFullYear() &&
    parsed.getMonth() === comparisonDate.getMonth()
  );
}

export function calculateInvoicePaymentTotal(invoice: Invoice) {
  const explicitPaymentTotal = (invoice.payments ?? []).reduce((total, payment) => total + payment.amount, 0);

  if (explicitPaymentTotal > 0) {
    return Math.min(explicitPaymentTotal, parseInvoiceAmount(invoice.amount));
  }

  return invoice.status === 'Paid' ? parseInvoiceAmount(invoice.amount) : 0;
}

export function calculateInvoiceBalance(invoice: Invoice) {
  return Math.max(parseInvoiceAmount(invoice.amount) - calculateInvoicePaymentTotal(invoice), 0);
}

export function saveInvoice(invoice: Invoice, originalInvoiceNumber?: string) {
  const lookupInvoiceNumber = originalInvoiceNumber ?? invoice.invoice;
  const existingInvoiceIndex = invoicesSnapshot.findIndex((item) => item.invoice === lookupInvoiceNumber);

  if (existingInvoiceIndex >= 0) {
    const existingInvoice = invoicesSnapshot[existingInvoiceIndex];
    const invoiceToSave = {
      ...invoice,
      payments: invoice.payments ?? existingInvoice.payments,
    };

    invoicesSnapshot = invoicesSnapshot.map((item, index) =>
      index === existingInvoiceIndex ? invoiceToSave : item
    );
    addActivity(`Invoice #${invoice.invoice} updated`);
  } else {
    invoicesSnapshot = [invoice, ...invoicesSnapshot];
    addActivity(`Invoice #${invoice.invoice} created`);
  }

  persistData(LOCAL_STORAGE_KEY, invoicesSnapshot);
  refreshInvoiceStatuses();
  emitChange();
}

export function updateInvoiceStatus(invoiceNumber: string, status: InvoiceStatus) {
  if (status === 'Paid') {
    const invoice = invoicesSnapshot.find((item) => item.invoice === invoiceNumber);
    const balance = invoice ? calculateInvoiceBalance(invoice) : 0;

    if (invoice && balance > 0) {
      receiveInvoicePayment(invoiceNumber, {
        amount: balance,
        date: new Date().toISOString(),
      });
      return;
    }
  }

  invoicesSnapshot = invoicesSnapshot.map((invoice) =>
    invoice.invoice === invoiceNumber ? { ...invoice, status } : invoice
  );
  persistData(LOCAL_STORAGE_KEY, invoicesSnapshot);
  addActivity(`Invoice #${invoiceNumber} marked ${status}`);
  refreshInvoiceStatuses();
  emitChange();
}

export function receiveInvoicePayment(invoiceNumber: string, paymentInput: ReceiveInvoicePaymentInput) {
  const invoice = invoicesSnapshot.find((item) => item.invoice === invoiceNumber);

  if (!invoice) {
    return;
  }

  const currentBalance = calculateInvoiceBalance(invoice);
  const receivedAmount = Math.min(Math.max(paymentInput.amount, 0), currentBalance);

  if (receivedAmount <= 0) {
    return;
  }

  const payment: InvoicePayment = {
    id: generateId(),
    amount: receivedAmount,
    date: paymentInput.date,
    notes: paymentInput.notes?.trim() || undefined,
  };

  invoicesSnapshot = invoicesSnapshot.map((item) => {
    if (item.invoice !== invoiceNumber) {
      return item;
    }

    const payments = [...(item.payments ?? []), payment];
    const updatedInvoice = { ...item, payments };
    const balance = calculateInvoiceBalance(updatedInvoice);

    return {
      ...updatedInvoice,
      status: balance <= 0 ? 'Paid' : item.status === 'Draft' ? 'Sent' : item.status,
    };
  });

  persistData(LOCAL_STORAGE_KEY, invoicesSnapshot);
  addActivity(`Payment received: ${formatInvoiceAmount(receivedAmount)} from ${invoice.customer} for invoice #${invoiceNumber}`);
  refreshInvoiceStatuses();
  emitChange();
}

export function calculateInvoiceTotal(invoices: Invoice[]) {
  return invoices.reduce((total, invoice) => total + parseInvoiceAmount(invoice.amount), 0);
}

export function isInvoiceWaitingToBePaid(invoice: Invoice) {
  return invoice.status === 'Sent' || invoice.status === 'Overdue' || invoice.status === 'Due Today';
}

export function calculateWaitingToBePaidTotal(invoices: Invoice[]) {
  return invoices.filter(isInvoiceWaitingToBePaid).reduce((total, invoice) => total + calculateInvoiceBalance(invoice), 0);
}

export function calculatePaidInvoiceTotal(invoices: Invoice[], comparisonDate = new Date()) {
  return invoices.reduce((total, invoice) => {
    const paymentsThisMonth = (invoice.payments ?? [])
      .filter((payment) => isSameMonth(payment.date, comparisonDate))
      .reduce((paymentTotal, payment) => paymentTotal + payment.amount, 0);

    if (paymentsThisMonth > 0) {
      return total + paymentsThisMonth;
    }

    if (invoice.status === 'Paid' && !invoice.payments?.length && isSameMonth(invoice.invoiceDate, comparisonDate)) {
      return total + parseInvoiceAmount(invoice.amount);
    }

    return total;
  }, 0);
}

export function useInvoices() {
  refreshInvoiceStatuses();
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => invoicesSnapshot,
    () => invoicesSnapshot
  );
}
