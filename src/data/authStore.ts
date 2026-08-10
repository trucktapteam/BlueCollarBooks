import type { Session } from '@supabase/supabase-js';
import { useSyncExternalStore } from 'react';
import { supabase } from '@/lib/supabase';

// Real authentication, backed by Supabase Auth - replaces the old
// bcb_dev_logged_in localStorage flag that never checked a password at all.
// This module tracks the current session in memory and keeps it in sync via
// Supabase's onAuthStateChange listener, the same snapshot+listeners pattern
// every other store in src/data uses.

let session: Session | null = null;
// Starts false so the root layout can wait for the first real answer from
// Supabase (getSession()) before deciding whether to redirect to /login -
// without this, a signed-in user would flash to /login on every refresh
// because the initial `session` value has to start as something.
let isInitialized = false;
const listeners = new Set<() => void>();

function emitChange() {
  listeners.forEach((listener) => listener());
}

supabase.auth.getSession().then(({ data }) => {
  session = data.session;
  isInitialized = true;
  emitChange();
});

supabase.auth.onAuthStateChange((_event, newSession) => {
  session = newSession;
  isInitialized = true;
  emitChange();
});

export function useSession() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => session,
    () => session
  );
}

export function useAuthInitialized() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => isInitialized,
    () => isInitialized
  );
}

export async function signInWithPassword(email: string, password: string) {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
}

export async function signUpWithPassword(email: string, password: string) {
  const { error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
}

export async function signOut() {
  await supabase.auth.signOut();
}
