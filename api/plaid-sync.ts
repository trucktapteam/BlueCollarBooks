import type { VercelRequest, VercelResponse } from '@vercel/node';
import { plaidClient } from '../src/server/plaidAdmin';
import { supabaseAdmin, getUserFromAuthHeader } from '../src/server/supabaseAdmin';
import { toISODateString } from '../src/utils/date';

// Called by the client (a "Refresh" action on the Bank Accounts card) to
// pull current balances for every account the signed-in user has connected
// through Plaid. Transaction history is a separate follow-up - this only
// refreshes the numbers already shown on the dashboard.
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
      .select('access_token')
      .eq('user_id', user.id);

    if (itemsError) {
      throw itemsError;
    }
    if (!items || items.length === 0) {
      return res.status(200).json({ updated: 0 });
    }

    const today = toISODateString(new Date());
    let updated = 0;

    for (const item of items) {
      const accountsResponse = await plaidClient.accountsGet({ access_token: item.access_token });

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

    return res.status(200).json({ updated });
  } catch (error) {
    console.error('Failed to sync Plaid balances', error);
    return res.status(500).json({ error: 'Failed to refresh balances' });
  }
}
