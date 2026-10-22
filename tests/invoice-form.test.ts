import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInvoiceForSave, type InvoiceFormValues } from '../src/utils/invoiceForm.ts';

const form: InvoiceFormValues = {
  id: 'inv-1', number: '26040', customer: ' ABC Steel ', customerId: 'c1', amountCents: 62500,
  status: 'Draft', date: '4/1/2026', terms: 'Net 30', poNumber: '', bolNumber: '', shipper: '',
  consignee: '', freightDescription: '', lineItems: [{ id: 'li1', description: 'Freight', amount: 62500 }],
};

test('form builder trims the customer and normalizes the date', () => {
  const inv = buildInvoiceForSave(form);
  assert.equal(inv.customer, 'ABC Steel');
  assert.equal(inv.invoiceDate, '2026-04-01');
});

// KNOWN BUG (audit): the terms typed on the form never reach saveInvoice, so
// every invoice is stored with terms = null and due dates silently fall back
// to the invoice date. Fixed in the next commit.
test('invoice terms from the form are included in what gets saved', { todo: 'terms are dropped before save' }, () => {
  const inv = buildInvoiceForSave(form) as { terms?: string };
  assert.equal(inv.terms, 'Net 30');
});
