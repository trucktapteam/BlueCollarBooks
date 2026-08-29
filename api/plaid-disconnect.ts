import type { VercelRequest, VercelResponse } from '@vercel/node';
import { plaidClient } from '../src/server/plaidAdmin';
import { supabaseAdmin, getUserFromAuthHeader } from '../src/server/supabaseAdmin';

// Called when a user disconnects a bank connection from the dashboard.
// Invalidates the access_token at Plaid (so it can no longer be used to
// pull data even if it somehow leaked) and removes the connection and its
// accounts from our own database. Scoped to the signed-in user's own items
// only - itemId alone isn't enough to disconnect something, it also has to
// belong to this user.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await getUserFromAuthHeader(req.headers.authorization);
  if (!user) {
    return res.status(401).json({ error: 'Not signed in' });
  }

  const itemId = typeof req.body?.itemId === 'string' ? req.body.itemId : undefined;
  if (!itemId) {
    return res.status(400).json({ error: 'Missing itemId' });
  }

  try {
    const { data: item, error: itemLookupError } = await supabaseAdmin
      .from('plaid_items')
      .select('access_token')
      .eq('item_id', itemId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (itemLookupError) {
      throw itemLookupError;
    }
    if (!item) {
      return res.status(404).json({ error: 'Bank connection not found' });
    }

    try {
      await plaidClient.itemRemove({ access_token: item.access_token });
    } catch (plaidError) {
      // If Plaid's already invalidated this item on their end (e.g. it was
      // already broken - see api/plaid-sync.ts's needs_reauth handling),
      // itemRemove can fail even though there's nothing left to clean up
      // there. Don't let that block removing our own copy of it.
      console.error('Plaid itemRemove failed, continuing to remove local records', plaidError);
    }

    const { error: accountsError } = await supabaseAdmin
      .from('bank_accounts')
      .delete()
      .eq('user_id', user.id)
      .eq('plaid_item_id', itemId);
    if (accountsError) {
      throw accountsError;
    }

    const { error: itemDeleteError } = await supabaseAdmin
      .from('plaid_items')
      .delete()
      .eq('user_id', user.id)
      .eq('item_id', itemId);
    if (itemDeleteError) {
      throw itemDeleteError;
    }

    return res.status(200).json({ disconnected: true });
  } catch (error) {
    console.error('Failed to disconnect Plaid item', error);
    return res.status(500).json({ error: 'Failed to disconnect bank account' });
  }
}
