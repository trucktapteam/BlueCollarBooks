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

export function planPlaidPageWrites(page: PlaidSyncPage, ctx: { userId: string; itemId: string; nowIso: string }) {
  const upsertRows = [...page.added, ...page.modified].map((txn) => ({
    id: txn.transaction_id,
    user_id: ctx.userId,
    plaid_item_id: ctx.itemId,
    plaid_account_id: txn.account_id,
    date: txn.date,
    name: txn.name,
    merchant_name: txn.merchant_name ?? null,
    amount: Math.round(txn.amount * 100),
    pending: txn.pending,
    plaid_category: flattenPlaidCategory(txn),
    updated_at: ctx.nowIso,
  }));
  const removedIds = page.removed.map((t) => t.transaction_id).filter((id): id is string => Boolean(id));
  return { upsertRows, removedIds };
}
