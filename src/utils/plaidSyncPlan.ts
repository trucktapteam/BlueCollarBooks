// Turns one page of Plaid /transactions/sync output into the database writes
// the sync endpoint performs. Extracted from api/plaid-transactions-sync.ts
// unchanged so the pending->posted behavior can be tested.
export type PlaidSyncTxn = {
  transaction_id: string;
  account_id: string;
  date: string;
  name: string;
  merchant_name?: string | null;
  amount: number;
  pending: boolean;
  pending_transaction_id?: string | null;
  personal_finance_category?: { primary?: string | null; detailed?: string | null } | null;
  category?: string[] | null;
};

export type PlaidSyncPage = {
  added: PlaidSyncTxn[];
  modified: PlaidSyncTxn[];
  removed: { transaction_id?: string | null }[];
};

export function flattenPlaidCategory(txn: Pick<PlaidSyncTxn, 'personal_finance_category' | 'category'>): string | null {
  const parts = [
    txn.personal_finance_category?.primary,
    txn.personal_finance_category?.detailed,
    ...(txn.category ?? []),
  ].filter((part): part is string => Boolean(part));
  return parts.length ? parts.join(' / ') : null;
}

// One page of Plaid output becomes ONE database call (apply_plaid_sync_page), which writes the rows,
// links a posted transaction to the pending one it replaced (carrying over anything the user already
// decided), and marks removed transactions as removed instead of deleting them.
export type PlannedPlaidRow = {
  id: string;
  plaid_account_id: string;
  date: string;
  name: string;
  merchant_name: string | null;
  amount: number;
  pending: boolean;
  plaid_category: string | null;
  pending_transaction_id: string | null;
};

function toRow(txn: PlaidSyncTxn): PlannedPlaidRow {
  return {
    id: txn.transaction_id,
    plaid_account_id: txn.account_id,
    date: txn.date,
    name: txn.name,
    merchant_name: txn.merchant_name ?? null,
    amount: Math.round(txn.amount * 100),
    pending: txn.pending,
    plaid_category: flattenPlaidCategory(txn),
    pending_transaction_id: txn.pending_transaction_id ?? null,
  };
}

export function planPlaidPageWrites(page: PlaidSyncPage) {
  const addedRows = page.added.map(toRow);
  const modifiedRows = page.modified.map(toRow);
  const removedIds = page.removed.map((t) => t.transaction_id).filter((id): id is string => Boolean(id));
  return { addedRows, modifiedRows, removedIds };
}
