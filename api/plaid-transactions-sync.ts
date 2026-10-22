import type { VercelRequest, VercelResponse } from '@vercel/node';
import { plaidClient } from '../src/server/plaidAdmin';
import { supabaseAdmin, getUserFromAuthHeader } from '../src/server/supabaseAdmin';
import { planPlaidPageWrites } from '../src/utils/plaidSyncPlan';

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

          const { addedRows, modifiedRows, removedIds } = planPlaidPageWrites(page);

          // One atomic database call per page: writes the rows, keeps a pending
          // charge and the posted charge that replaced it as ONE transaction
          // (carrying over whatever the user already decided), and marks
          // removed transactions as removed instead of deleting them.
          const { error: applyError } = await supabaseAdmin.rpc('apply_plaid_sync_page', {
            p_user: user.id,
            p_item: item.item_id,
            p_added: addedRows,
            p_modified: modifiedRows,
            p_removed: removedIds,
          });
          if (applyError) {
            throw applyError;
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
