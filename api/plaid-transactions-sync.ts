import type { VercelRequest, VercelResponse } from '@vercel/node';
import { plaidClient } from '../src/server/plaidAdmin';
import { supabaseAdmin, getUserFromAuthHeader } from '../src/server/supabaseAdmin';

// Same reauth-detection pattern as api/plaid-sync.ts - see that file for the
// full explanation of these error codes.
const REAUTH_ERROR_CODES = new Set(['ITEM_LOGIN_REQUIRED', 'PENDING_EXPIRATION', 'PENDING_DISCONNECT']);

function getPlaidErrorCode(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'response' in error) {
    const response = (error as { response?: { data?: { error_code?: string } } }).response;
    return response?.data?.error_code;
  }
  return undefined;
}

// Plaid's transactionsSync gives us either the newer personal_finance_category
// object or the legacy category array (sometimes both, sometimes neither in
// Sandbox) - flatten whatever's there into one string for storage. The actual
// app-category guess (src/utils/suggestCategory.ts) runs client-side against
// this so the mapping rules can improve later without re-syncing.
function flattenPlaidCategory(txn: {
  personal_finance_category?: { primary?: string | null; detailed?: string | null } | null;
  category?: string[] | null;
}): string | null {
  const parts = [
    txn.personal_finance_category?.primary,
    txn.personal_finance_category?.detailed,
    ...(txn.category ?? []),
  ].filter((part): part is string => Boolean(part));
  return parts.length ? parts.join(' / ') : null;
}

// Called by the client (the Transactions review screen, and periodically
// whenever the dashboard's Refresh Balances runs) to pull new/changed bank
// transactions for every account the signed-in user has connected through
// Plaid. Uses Plaid's cursor-based /transactions/sync so repeat calls only
// fetch what changed since last time, rather than re-downloading everything.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await getUserFromAuthHeader(req.headers.authorization);
  if (!user) {
    return res.status(401).json({ error: 'Not signed in' });
  }

  try {
    const { data: items, error: itemsError } = await supabaseAdmin
      .from('plaid_items')
      .select('item_id, access_token, transactions_cursor')
      .eq('user_id', user.id);

    if (itemsError) {
      throw itemsError;
    }
    if (!items || items.length === 0) {
      return res.status(200).json({ added: 0, modified: 0, removed: 0, needsReauth: 0 });
    }

    let added = 0;
    let modified = 0;
    let removed = 0;
    let needsReauth = 0;

    for (const item of items) {
      let cursor = item.transactions_cursor ?? undefined;
      let hasMore = true;

      try {
        while (hasMore) {
          const response = await plaidClient.transactionsSync({
            access_token: item.access_token,
            cursor,
          });
          const page = response.data;

          const upsertRows = [...page.added, ...page.modified].map((txn) => ({
            id: txn.transaction_id,
            user_id: user.id,
            plaid_item_id: item.item_id,
            plaid_account_id: txn.account_id,
            date: txn.date,
            name: txn.name,
            merchant_name: txn.merchant_name ?? null,
            amount: Math.round(txn.amount * 100),
            pending: txn.pending,
            plaid_category: flattenPlaidCategory(txn),
            updated_at: new Date().toISOString(),
          }));

          if (upsertRows.length > 0) {
            // Only touch Plaid-owned columns here - never overwrite the
            // user's own category/excluded/expense_id choices on a
            // transaction that already went through review.
            const { error: upsertError } = await supabaseAdmin
              .from('plaid_transactions')
              .upsert(upsertRows, { onConflict: 'id', ignoreDuplicates: false });
            if (upsertError) {
              throw upsertError;
            }
          }

          if (page.removed.length > 0) {
            const removedIds = page.removed.map((t) => t.transaction_id).filter((id): id is string => Boolean(id));
            if (removedIds.length > 0) {
              const { error: deleteError } = await supabaseAdmin
                .from('plaid_transactions')
                .delete()
                .in('id', removedIds)
                .eq('user_id', user.id);
              if (deleteError) {
                throw deleteError;
              }
            }
          }

          added += page.added.length;
          modified += page.modified.length;
          removed += page.removed.length;
          cursor = page.next_cursor;
          hasMore = page.has_more;
        }

        await supabaseAdmin
          .from('plaid_items')
          .update({ transactions_cursor: cursor, needs_reauth: false })
          .eq('item_id', item.item_id);
      } catch (syncError) {
        const errorCode = getPlaidErrorCode(syncError);
        if (errorCode && REAUTH_ERROR_CODES.has(errorCode)) {
          needsReauth += 1;
          await supabaseAdmin.from('plaid_items').update({ needs_reauth: true }).eq('item_id', item.item_id);
          await supabaseAdmin.from('bank_accounts').update({ needs_reauth: true }).eq('plaid_item_id', item.item_id);
        } else {
          console.error('Failed to sync transactions for Plaid item', item.item_id, syncError);
        }
      }
    }

    return res.status(200).json({ added, modified, removed, needsReauth });
  } catch (error) {
    console.error('Failed to sync Plaid transactions', error);
    return res.status(500).json({ error: 'Failed to sync transactions' });
  }
}
