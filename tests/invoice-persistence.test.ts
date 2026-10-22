import test from 'node:test';
import assert from 'node:assert/strict';
import { writeInvoiceRows, type InvoiceDbClient } from '../src/data/invoicePersistence.ts';

function recordingClient(result: { error: { code?: string; message?: string } | null } = { error: null }) {
  const calls: { name: string; args: Record<string, any> }[] = [];
  const client: InvoiceDbClient = {
    rpc: async (name, args) => {
      calls.push({ name, args: args as Record<string, any> });
      return result;
    },
  };
  return { calls, client };
}

const base = { id: 'inv1', invoice: '1', customer: 'X', amount: 100, status: 'Draft', invoiceDate: '2026-06-01' };

test('terms and a due date derived from them are sent with the invoice', async () => {
  const { calls, client } = recordingClient();
  await writeInvoiceRows(client, 'u1', { ...base, terms: 'Net 30', lineItems: [] });
  assert.equal(calls[0].args.p_invoice.terms, 'Net 30');
  assert.equal(calls[0].args.p_invoice.due_date, '2026-07-01');
});

// Regression test for an audit finding: saveInvoice used to delete all line items and re-insert them as
// separate statements, so a failure in between lost the invoice's line items. It is now ONE database call
// (an atomic function); the transactional behavior itself is proven in tests/sql/invoice_save.sql.
test('the whole save (invoice + all line items) is a single atomic database call', async () => {
  const { calls, client } = recordingClient();
  await writeInvoiceRows(client, 'u1', {
    ...base,
    lineItems: [{ id: 'a', description: 'old', amount: 60 }, { id: 'b', description: 'new', amount: 40 }],
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'save_invoice');
  assert.deepEqual(calls[0].args.p_lines.map((l: any) => l.id), ['a', 'b']);
});

test('a database error is surfaced to the caller unchanged (e.g. duplicate invoice number 23505)', async () => {
  const { client } = recordingClient({ error: { code: '23505', message: 'dup' } });
  await assert.rejects(() => writeInvoiceRows(client, 'u1', { ...base, lineItems: [] }), (e: any) => e.code === '23505');
});
