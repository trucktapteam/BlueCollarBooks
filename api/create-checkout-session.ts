import type { VercelRequest, VercelResponse } from '@vercel/node';
import { stripe, MONTHLY_PRICE_ID } from '../src/server/stripeAdmin';
import { supabaseAdmin, getUserFromAuthHeader } from '../src/server/supabaseAdmin';

// Called by the client (see src/data/subscriptionStore.ts) when a signed-in
// user wants to start their 30-day trial / subscribe. Creates a Stripe
// Checkout Session in subscription mode and hands back the URL to redirect
// the browser to - Stripe hosts the actual payment form, we never touch
// card data (see the "Stripe-hosted Checkout" decision in the integration
// plan this app was built from).
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const user = await getUserFromAuthHeader(req.headers.authorization);
  if (!user || !user.email) {
    return res.status(401).json({ error: 'Not signed in' });
  }

  try {
    // Reuse an existing Stripe customer for this user if one's already on
    // file (e.g. they started a trial before, or reused after canceling),
    // instead of creating a duplicate customer every time.
    const { data: existing } = await supabaseAdmin
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', user.id)
      .maybeSingle();

    let customerId = existing?.stripe_customer_id ?? undefined;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { supabase_user_id: user.id },
      });
      customerId = customer.id;
    }

    const origin = req.headers.origin ?? `https://${req.headers.host}`;

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      client_reference_id: user.id,
      line_items: [{ price: MONTHLY_PRICE_ID, quantity: 1 }],
      subscription_data: {
        trial_period_days: 30,
        metadata: { supabase_user_id: user.id },
      },
      success_url: `${origin}/settings?checkout=success`,
      cancel_url: `${origin}/settings?checkout=canceled`,
    });

    return res.status(200).json({ url: session.url });
  } catch (error) {
    console.error('Failed to create checkout session', error);
    return res.status(500).json({ error: 'Failed to create checkout session' });
  }
}
