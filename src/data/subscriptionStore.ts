import { useSyncExternalStore } from 'react';
import { supabase } from '@/lib/supabase';

// Mirrors the public.subscriptions row the Stripe webhook (api/stripe-webhook.ts)
// writes for this user. Statuses match Stripe's own subscription.status values
// (trialing, active, past_due, canceled, unpaid, incomplete, ...) plus our own
// 'none' default for a user who's never started checkout.
export type SubscriptionStatus =
  | 'none'
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'unpaid'
  | 'incomplete'
  | 'incomplete_expired'
  | 'paused';

export type Subscription = {
  status: SubscriptionStatus;
  trialEnd: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
};

// Statuses that should let a user into the app. Everything else (past_due,
// canceled, unpaid, or 'none' for someone who never started a trial) routes
// to the subscribe screen. past_due is intentionally excluded - Stripe's
// Smart Retries are already trying to collect, but access shouldn't stay
// open indefinitely on a card that's failing.
const ACCESS_GRANTED_STATUSES: SubscriptionStatus[] = ['trialing', 'active'];

let subscriptionSnapshot: Subscription | null = null;
let hasLoadedOnce = false;
const listeners = new Set<() => void>();

function emitChange() {
  listeners.forEach((listener) => listener());
}

export async function loadSubscription(userId: string) {
  const { data, error } = await supabase
    .from('subscriptions')
    .select('status, trial_end, current_period_end, cancel_at_period_end')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    console.error('Failed to load subscription', error);
  }

  subscriptionSnapshot = data
    ? {
        status: data.status as SubscriptionStatus,
        trialEnd: data.trial_end,
        currentPeriodEnd: data.current_period_end,
        cancelAtPeriodEnd: data.cancel_at_period_end,
      }
    : { status: 'none', trialEnd: null, currentPeriodEnd: null, cancelAtPeriodEnd: false };
  hasLoadedOnce = true;
  emitChange();
}

export function clearSubscription() {
  subscriptionSnapshot = null;
  hasLoadedOnce = false;
  emitChange();
}

export function hasAccess(subscription: Subscription | null): boolean {
  if (!subscription) {
    return false;
  }
  return ACCESS_GRANTED_STATUSES.includes(subscription.status);
}

export function useSubscription() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => subscriptionSnapshot,
    () => subscriptionSnapshot
  );
}

// True once loadSubscription/clearSubscription has run at least once for the
// current session - lets the layout distinguish "still checking" from
// "checked, and there's no active subscription" the same way authStore's
// isInitialized flag works for the sign-in check.
export function useSubscriptionInitialized() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => hasLoadedOnce,
    () => hasLoadedOnce
  );
}
