import test from 'node:test';
import assert from 'node:assert/strict';
import { writeInvoiceRows, type InvoiceDbClient } from '../src/data/invoicePersistence.ts';

// Minimal in-memory stand-in for the database. Like the real client, each call
// is its own statement - there is no transaction spanning the delete+insert.
function fakeDb(opts: { failLineItemInsert?: boolean } = {}) {
  const tables: Record<string, Record<string, unknown>[]> = { invoices: [], invoice_line_items: [] };
  const client: InvoiceDbClient = {
    from: (table) => ({
      upsert: async (row) => {
        tables[table] = tables[table].filter((r) => r.id !== row.id).concat(row);
        return { error: null };
      },
      insert: async (rows) => {
        if (opts.failLineItemInsert) return { error: { code: 'XX000', message: 'boom' } };
        tables[table].push(...rows);
        return { error: null };
      },
      delete: () => ({
        eq: async (col, val) => {
          tables[table] = tables[table].filter((r) => r[col] !== val);
          return { error: null };
        },
      }),
    }),
  };
  return { tables, client };
}

const base = { id: 'inv1', invoice: '1', customer: 'X', amount: 100, status: 'Draft', invoiceDate: '2026-06-01' };

test('editing an invoice replaces its line items', async () => {
  const { tables, client } = fakeDb();
  await writeInvoiceRows(client, 'u1', { ...base, lineItems: [{ id: 'a', description: 'old', amount: 100 }] });
  await writeInvoiceRows(client, 'u1', { ...base, lineItems: [{ id: 'b', description: 'new', amount: 100 }] });
  assert.deepEqual(tables.invoice_line_items.map((r) => r.id), ['b']);
});

// KNOWN BUG (audit): saveInvoice deletes the old line items and then inserts
// the new ones as separate statements. If the insert fails, the invoice is
// left with no line items at all. Fixed by one atomic database function in
// Stage C.
test('a failed save leaves the previous line items intact (atomic)', { todo: 'delete and insert are not atomic' }, async () => {
  const { tables, client } = fakeDb();
  await writeInvoiceRows(client, 'u1', { ...base, lineItems: [{ id: 'a', description: 'old', amount: 100 }] });
  const failing = fakeDb({ failLineItemInsert: true });
  failing.tables.invoice_line_items = [...tables.invoice_line_items];
  await assert.rejects(() => writeInvoiceRows(failing.client, 'u1', { ...base, lineItems: [{ id: 'b', description: 'new', amount: 100 }] }));
  assert.deepEqual(failing.tables.invoice_line_items.map((r) => r.id), ['a']);
});
