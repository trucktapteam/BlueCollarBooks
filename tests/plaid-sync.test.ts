import test from 'node:test';
import assert from 'node:assert/strict';
import { planPlaidPageWrites, type PlaidSyncTxn } from '../src/utils/plaidSyncPlan.ts';

const ctx = { userId: 'u1', itemId: 'item1', nowIso: '2026-10-21T00:00:00Z' };
const txn = (over: Partial<PlaidSyncTxn>): PlaidSyncTxn => ({
  transaction_id: 't1', account_id: 'a1', date: '2026-06-10', name: 'Starbucks', amount: 4.33, pending: false, ...over,
});

test('amounts are converted to integer cents and rows are keyed by transaction id', () => {
  const { upsertRows } = planPlaidPageWrites({ added: [txn({})], modified: [], removed: [] }, ctx);
  assert.equal(upsertRows[0].id, 't1');
  assert.equal(upsertRows[0].amount, 433);
});

// KNOWN BUG (audit): when a pending charge posts, Plaid sends the pending id
// as `removed` and the posted charge as `added` with pending_transaction_id.
// We never store that link and hard-delete the pending row, so a charge the
// user already categorized comes back as a brand-new uncategorized one.
const pendingToPosted = {
  added: [txn({ transaction_id: 'posted1', pending: false, pending_transaction_id: 'pend1' })],
  modified: [],
  removed: [{ transaction_id: 'pend1' }],
};

test('posted transaction remembers which pending transaction it replaced', { todo: 'pending_transaction_id is not stored' }, () => {
  const { upsertRows } = planPlaidPageWrites(pendingToPosted, ctx);
  assert.equal((upsertRows[0] as Record<string, unknown>).pending_transaction_id, 'pend1');
});

test('a replaced pending transaction is reconciled, not hard-deleted', { todo: 'removed ids are deleted outright' }, () => {
  const { removedIds } = planPlaidPageWrites(pendingToPosted, ctx);
  assert.ok(!removedIds.includes('pend1'));
});
