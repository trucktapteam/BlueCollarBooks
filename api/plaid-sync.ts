import type { VercelRequest, VercelResponse } from '@vercel/node';
import { plaidClient } from '../src/server/plaidAdmin';
import { supabaseAdmin, getUserFromAuthHeader } from '../src/server/supabaseAdmin';
import { toISODateString } from '../src/utils/date';

// Plaid's error responses come through as an Axios error with the actual
// Plaid error body at error.response.data - see
// https://plaid.com/docs/errors/. ITEM_LOGIN_REQUIRED (and a few related
// codes) mean the bank connection itself is broken - expired credentials,
// the bank forced a re-verification, MFA changed, etc. - and no amount of
// retrying will fix it; the user has to go through Link again.
const REAUTH_ERROR_CODES = new Set([
  'ITEM_LOGIN_REQUIRED',
  'PENDING_EXPIRATION',
  'PENDING_DISCONNECT',
]);

function getPlaidErrorCode(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'response' in error) {
    const response = (error as { response?: { data?: { error_code?: string } } }).response;
    return response?.data?.error_code;
  }
  return undefined;
}

// Called by the client (a "Refresh Balances" action on the Bank Accounts
// card) to pull current balances for every account the signed-in user has
// connected through Plaid. Transaction history is a separate follow-up -
// this only refreshes the numbers already shown on the dashboard.
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
      .select('item_id, access_token')
      .eq('user_id', user.id);

    if (itemsError) {
      throw itemsError;
    }
    if (!items || items.length === 0) {
      return res.status(200).json({ updated: 0, needsReauth: 0 });
    }

    const today = toISODateString(new Date());
    let updated = 0;
    let needsReauth = 0;

    for (const item of items) {
      let accountsResponse;
      try {
        accountsResponse = await plaidClient.accountsGet({ access_token: item.access_token });
      } catch (fetchError) {
        const errorCode = getPlaidErrorCode(fetchError);
        if (errorCode && REAUTH_ERROR_CODES.has(errorCode)) {
          needsReauth += 1;
          await supabaseAdmin.from('plaid_items').update({ needs_reauth: true }).eq('item_id', item.item_id);
          await supabaseAdmin.from('bank_accounts').update({ needs_reauth: true }).eq('plaid_item_id', item.item_id);
        } else {
          console.error('Failed to fetch accounts for Plaid item', item.item_id, fetchError);
        }
        continue;
      }

      // A successful fetch means this connection is healthy, even if it was
      // previously flagged - clear any stale needs_reauth state.
      await supabaseAdmin.from('plaid_items').update({ needs_reauth: false }).eq('item_id', item.item_id);
      await supabaseAdmin.from('bank_accounts').update({ needs_reauth: false }).eq('plaid_item_id', item.item_id);

      for (const account of accountsResponse.data.accounts) {
        const { error: updateError, count } = await supabaseAdmin
          .from('bank_accounts')
          .update(
            {
              balance: Math.round((account.balances.current ?? 0) * 100),
              last_updated: today,
            },
            { count: 'exact' }
          )
          .eq('user_id', user.id)
          .eq('plaid_account_id', account.account_id);

        if (updateError) {
          console.error('Failed to update balance for account', account.account_id, updateError);
          continue;
        }
        updated += count ?? 1;
      }
    }

    return res.status(200).json({ updated, needsReauth });
  } catch (error) {
    console.error('Failed to sync Plaid balances', error);
    return res.status(500).json({ error: 'Failed to refresh balances' });
  }
}
