import type { VercelRequest, VercelResponse } from '@vercel/node';
import { Buffer } from 'node:buffer';
import type Stripe from 'stripe';
import { stripe } from '../src/server/stripeAdmin';
import { supabaseAdmin } from '../src/server/supabaseAdmin';

// Stripe calls this URL directly (configured in the Stripe Dashboard under
// Developers > Webhooks) whenever a subscription-related event happens.
// This is the *only* place subscription status gets written to Supabase -
// never trust the client to report its own subscription state, since
// that'd let anyone fake a paid subscription by calling our own API.
//
// Disabling Vercel's default body parser is required: Stripe's signature
// verification needs the exact raw request bytes, and a JSON.parse/
// re-stringify round trip would produce a byte-for-byte different body,
// making every signature check fail.
export const config = {
  api: {
    bodyParser: false,
  },
};

async function buffer(req: VercelRequest): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

// Maps a Stripe subscription object onto our subscriptions table. Called
// from every event type below so all of them stay in sync the same way,
// rather than duplicating this mapping per event.
async function upsertFromSubscription(subscription: Stripe.Subscription, userId?: string) {
  const resolvedUserId = userId ?? subscription.metadata.supabase_user_id;
  if (!resolvedUserId) {
    console.error('Stripe subscription has no linked Supabase user id', subscription.id);
    return;
  }

  const { error } = await supabaseAdmin.from('subscriptions').upsert(
    {
      user_id: resolvedUserId,
      stripe_customer_id:
        typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id,
      stripe_subscription_id: subscription.id,
      status: subscription.status,
      trial_end: subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null,
      current_period_end: subscription.items.data[0]?.current_period_end
        ? new Date(subscription.items.data[0].current_period_end * 1000).toISOString()
        : null,
      cancel_at_period_end: subscription.cancel_at_period_end,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' }
  );

  if (error) {
    console.error('Failed to upsert subscription', error);
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const signature = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!signature || !webhookSecret) {
    return res.status(400).json({ error: 'Missing signature or webhook secret' });
  }

  let event: Stripe.Event;
  try {
    const rawBody = await buffer(req);
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (error) {
    console.error('Webhook signature verification failed', error);
    return res.status(400).json({ error: 'Invalid signature' });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.mode === 'subscription' && session.subscription) {
          const subscriptionId =
            typeof session.subscription === 'string' ? session.subscription : session.subscription.id;
          const subscription = await stripe.subscriptions.retrieve(subscriptionId);
          await upsertFromSubscription(subscription, session.client_reference_id ?? undefined);
        }
        break;
      }
      case 'customer.subscription.updated':
      case 'customer.subscription.created':
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        await upsertFromSubscription(subscription);
        break;
      }
      default:
        // Other events (invoice.payment_failed, etc.) aren't acted on yet -
        // Stripe's Smart Retries + automated emails handle payment recovery
        // on their own, per the integration plan.
        break;
    }

    return res.status(200).json({ received: true });
  } catch (error) {
    console.error('Error handling webhook event', event.type, error);
    return res.status(500).json({ error: 'Webhook handler failed' });
  }
}
