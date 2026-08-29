import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid';

// Server-only, like stripeAdmin.ts - never import this from src/app or any
// client component. PLAID_SECRET is a live credential that can read a
// connected bank's balances and transactions, so it must never reach the
// Expo web client bundle. Only the api/ serverless functions (Vercel Node
// runtime) pull this in.
const clientId = process.env.PLAID_CLIENT_ID;
const secret = process.env.PLAID_SECRET;
// 'sandbox' while testing with Plaid's fake institutions; switch to
// 'development' or 'production' in Vercel env vars once Thomas applies for
// Production access and gets a real Production secret - same test/live
// split as STRIPE_SECRET_KEY.
const plaidEnv = process.env.PLAID_ENV ?? 'sandbox';

if (!clientId || !secret) {
  throw new Error('Missing PLAID_CLIENT_ID or PLAID_SECRET environment variable (set them in Vercel, not .env).');
}

const configuration = new Configuration({
  basePath: PlaidEnvironments[plaidEnv],
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': clientId,
      'PLAID-SECRET': secret,
    },
  },
});

export const plaidClient = new PlaidApi(configuration);
