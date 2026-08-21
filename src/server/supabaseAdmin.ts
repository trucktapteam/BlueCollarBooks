import { createClient } from '@supabase/supabase-js';

// Server-only, like stripeAdmin.ts. Two different Supabase clients live in
// this codebase on purpose:
//   - src/lib/supabase.ts: anon key, used by the browser, subject to RLS.
//   - this file: service role key, used only inside api/ serverless
//     functions, bypasses RLS entirely. That's required here because the
//     Stripe webhook has to write subscription rows for users who aren't
//     the one making the request (Stripe is the caller, not the user).
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error(
    'Missing EXPO_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY (set the service role key in Vercel, not .env).'
  );
}

export const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

// Verifies a Supabase access token (sent from the client as a Bearer token)
// and returns the user it belongs to, using the public anon key - the same
// way any RLS-respecting request would authenticate. Used by the two
// user-initiated endpoints (checkout, portal) to figure out who's asking,
// without trusting a client-supplied user id.
export async function getUserFromAuthHeader(authHeader: string | undefined) {
  const token = authHeader?.replace(/^Bearer\s+/i, '');
  if (!token) {
    return null;
  }

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) {
    console.error('getUserFromAuthHeader: token rejected', error?.message);
    return null;
  }
  return data.user;
}
