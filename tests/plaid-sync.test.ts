import test from 'node:test';
import assert from 'node:assert/strict';
import { planPlaidPageWrites, type PlaidSyncTxn } from '../src/utils/plaidSyncPlan.ts';

const txn = (over: Partial<PlaidSyncTxn>): PlaidSyncTxn => ({
  transaction_id: 't1', account_id: 'a1', date: '2026-06-10', name: 'Starbucks', amount: 4.33, pending: false, ...over,
});

test('amounts are converted to integer cents and rows are keyed by transaction id', () => {
  const { addedRows } = planPlaidPageWrites({ added: [txn({})], modified: [], removed: [] });
  assert.equal(addedRows[0].id, 't1');
  assert.equal(addedRows[0].amount, 433);
});

test('added and modified rows are kept apart and carry the bank account id', () => {
  const { addedRows, modifiedRows } = planPlaidPageWrites({ added: [txn({ transaction_id: 'a' })], modified: [txn({ transaction_id: 'm' })], removed: [] });
  assert.deepEqual(addedRows.map((r) => r.id), ['a']);
  assert.deepEqual(modifiedRows.map((r) => [r.id, r.plaid_account_id]), [['m', 'a1']]);
});

// When a pending charge posts, Plaid sends the pending id as `removed` and the posted charge as `added` with
// pending_transaction_id. The plan now hands BOTH to the database, which links them and keeps one transaction
// (the database behavior is tested in tests/sql/plaid_feed.sql).
const pendingToPosted = {
  added: [txn({ transaction_id: 'posted1', pending: false, pending_transaction_id: 'pend1' })],
  modified: [],
  removed: [{ transaction_id: 'pend1' }],
};

test('a posted transaction remembers which pending transaction it replaced', () => {
  const { addedRows } = planPlaidPageWrites(pendingToPosted);
  assert.equal(addedRows[0].pending_transaction_id, 'pend1');
});

test('removed ids are passed to the database to reconcile, never deleted by the sync plan', () => {
  const plan = planPlaidPageWrites(pendingToPosted);
  assert.deepEqual(plan.removedIds, ['pend1']);
  assert.equal('upsertRows' in plan, false);
});

test('a missing or blank removed id is ignored', () => {
  const { removedIds } = planPlaidPageWrites({ added: [], modified: [], removed: [{ transaction_id: null }, {}, { transaction_id: 'x' }] });
  assert.deepEqual(removedIds, ['x']);
});
