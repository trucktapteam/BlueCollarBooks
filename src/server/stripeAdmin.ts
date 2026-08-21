import Stripe from 'stripe';

// Server-only. Never import this from src/app or any client component - it
// reads the Stripe *secret* key, which must never reach the browser bundle.
// This file only gets pulled in by the api/ serverless functions, which run
// on Vercel's Node runtime, not in the Expo web client bundle.
const secretKey = process.env.STRIPE_SECRET_KEY;

if (!secretKey) {
  throw new Error('Missing STRIPE_SECRET_KEY environment variable (set it in Vercel, not .env).');
}

export const stripe = new Stripe(secretKey, {
  apiVersion: '2026-06-24.preview',
});

// The $20/month price created for Blue Collar Books' single subscription
// plan. Set as an env var rather than hardcoded so switching between the
// test-mode and live-mode price IDs is just a Vercel env var change.
export const MONTHLY_PRICE_ID = process.env.STRIPE_MONTHLY_PRICE_ID ?? 'price_1U6ilfLOxe3MogU56FCXWIxI';
