import type { VercelRequest, VercelResponse } from '@vercel/node';
import { CountryCode, Products } from 'plaid';
import { plaidClient } from '../src/server/plaidAdmin';
import { getUserFromAuthHeader } from '../src/server/supabaseAdmin';

// Called by the client (src/data/mockBankAccounts.ts) when a signed-in user
// clicks "Connect Bank". Returns a short-lived link_token that initializes
// Plaid Link in the browser - the actual bank login happens entirely inside
// Plaid's hosted UI, we never see the user's bank credentials.
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
    const response = await plaidClient.linkTokenCreate({
      user: { client_user_id: user.id },
      client_name: 'Blue Collar Books',
      // Transactions covers both transaction history and account balances -
      // there's no separate "Balances" product to request up front.
      products: [Products.Transactions],
      country_codes: [CountryCode.Us],
      language: 'en',
    });

    return res.status(200).json({ linkToken: response.data.link_token });
  } catch (error) {
    console.error('Failed to create Plaid link token', error);
    return res.status(500).json({ error: 'Failed to create link token' });
  }
}
