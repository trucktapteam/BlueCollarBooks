import type { VercelRequest, VercelResponse } from '@vercel/node';
import { CountryCode } from 'plaid';
import { plaidClient } from '../src/server/plaidAdmin';
import { supabaseAdmin, getUserFromAuthHeader } from '../src/server/supabaseAdmin';
import { generateId } from '../src/utils/id';
import { toISODateString } from '../src/utils/date';

// Called by the client once Plaid Link's onSuccess fires with a short-lived
// public_token. Exchanges it for a permanent access_token (stored server-
// side only, in plaid_items - never sent back to the browser), then pulls
// the linked accounts and their current balances into bank_accounts so the
// dashboard picks them up the same way it already does for manually-entered
// accounts.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await getUserFromAuthHeader(req.headers.authorization);
  if (!user) {
    return res.status(401).json({ error: 'Not signed in' });
  }

  const publicToken = typeof req.body?.publicToken === 'string' ? req.body.publicToken : undefined;
  if (!publicToken) {
    return res.status(400).json({ error: 'Missing publicToken' });
  }

  try {
    const exchange = await plaidClient.itemPublicTokenExchange({ public_token: publicToken });
    const { access_token: accessToken, item_id: itemId } = exchange.data;

    const accountsResponse = await plaidClient.accountsGet({ access_token: accessToken });
    const { accounts, item } = accountsResponse.data;

    let institutionName: string | null = null;
    if (item.institution_id) {
      try {
        const institutionResponse = await plaidClient.institutionsGetById({
          institution_id: item.institution_id,
          country_codes: [CountryCode.Us],
        });
        institutionName = institutionResponse.data.institution.name;
      } catch (institutionError) {
        // Non-fatal - the connection still works without a display name for
        // the institution, so don't block the whole connect flow on this.
        console.error('Failed to fetch institution name', institutionError);
      }
    }

    const { error: itemError } = await supabaseAdmin.from('plaid_items').insert({
      id: generateId(),
      user_id: user.id,
      item_id: itemId,
      access_token: accessToken,
      institution_id: item.institution_id,
      institution_name: institutionName,
    });
    if (itemError) {
      throw itemError;
    }

    const today = toISODateString(new Date());
    const accountRows = accounts.map((account) => ({
      id: generateId(),
      user_id: user.id,
      name: institutionName ? `${institutionName} ${account.name}` : account.name,
      last4: account.mask ?? '',
      // Plaid returns balances as dollar floats; the app stores cents
      // everywhere else (see src/utils/money.ts). current can be null for
      // some account types, hence the fallback.
      balance: Math.round((account.balances.current ?? 0) * 100),
      last_updated: today,
      plaid_item_id: itemId,
      plaid_account_id: account.account_id,
      subtype: account.subtype,
      official_name: account.official_name,
    }));

    const { error: accountsError } = await supabaseAdmin.from('bank_accounts').upsert(accountRows);
    if (accountsError) {
      throw accountsError;
    }

    return res.status(200).json({ connected: accountRows.length });
  } catch (error) {
    console.error('Failed to exchange Plaid public token', error);
    return res.status(500).json({ error: 'Failed to connect bank account' });
  }
}
