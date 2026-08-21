import type { VercelRequest, VercelResponse } from '@vercel/node';
import { stripe } from '../src/server/stripeAdmin';
import { supabaseAdmin, getUserFromAuthHeader } from '../src/server/supabaseAdmin';

// Lets a signed-in user manage their own subscription (update card, cancel,
// see invoices) via Stripe's hosted Customer Portal - no custom billing UI
// needed on our side.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await getUserFromAuthHeader(req.headers.authorization);
  if (!user) {
    return res.status(401).json({ error: 'Not signed in' });
  }

  const { data: subscription } = await supabaseAdmin
    .from('subscriptions')
    .select('stripe_customer_id')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!subscription?.stripe_customer_id) {
    return res.status(404).json({ error: 'No subscription on file yet' });
  }

  try {
    const origin = req.headers.origin ?? `https://${req.headers.host}`;
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: subscription.stripe_customer_id,
      return_url: `${origin}/settings`,
    });

    return res.status(200).json({ url: portalSession.url });
  } catch (error) {
    console.error('Failed to create portal session', error);
    return res.status(500).json({ error: 'Failed to create portal session' });
  }
}
