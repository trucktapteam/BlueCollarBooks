import type { VercelRequest, VercelResponse } from '@vercel/node';
import type Stripe from 'stripe';
import { stripe, MONTHLY_PRICE_ID } from '../src/server/stripeAdmin';
import { supabaseAdmin, getUserFromAuthHeader } from '../src/server/supabaseAdmin';

// managed_payments is a newer Checkout Session param the installed stripe
// SDK's TypeScript types (18.5.0) don't know about yet, even though the
// live API accepts it - see the comment below for why we need it. This
// extends the SDK's own params type instead of casting the whole object to
// any, so every other field here stays type-checked normally.
type SessionCreateParamsWithManagedPayments = Stripe.Checkout.SessionCreateParams & {
  managed_payments?: { enabled: boolean };
};

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

    const sessionParams: SessionCreateParamsWithManagedPayments = {
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
      // Managed Payments is on by default for new Stripe accounts and
      // requires every product to carry a tax_code - more setup than a
      // single flat-rate SaaS plan needs. We deliberately chose the plain
      // Stripe-hosted Checkout path (not Managed Payments) when planning
      // this integration, so opt back out of the account default here.
      managed_payments: { enabled: false },
    };

    const session = await stripe.checkout.sessions.create(sessionParams);

    return res.status(200).json({ url: session.url });
  } catch (error) {
    console.error('Failed to create checkout session', error);
    return res.status(500).json({ error: 'Failed to create checkout session' });
  }
}
