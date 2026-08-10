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

// Separate from `listeners` above: this is for non-React code (the data
// stores in this folder) that needs to react to "which user is signed in
// changed" - loading that user's rows in, or clearing out the previous
// user's rows on sign-out. See src/data/bootstrap.ts.
type AuthChangeListener = (session: Session | null) => void;
const authChangeListeners = new Set<AuthChangeListener>();

export function onAuthChange(listener: AuthChangeListener) {
  authChangeListeners.add(listener);
  return () => authChangeListeners.delete(listener);
}

function emitChange() {
  listeners.forEach((listener) => listener());
}

function setSession(newSession: Session | null) {
  session = newSession;
  isInitialized = true;
  emitChange();
  authChangeListeners.forEach((listener) => listener(session));
}

supabase.auth.getSession().then(({ data }) => {
  setSession(data.session);
});

supabase.auth.onAuthStateChange((_event, newSession) => {
  setSession(newSession);
});

// Synchronous read of the current user id, for use in the data stores'
// mutation functions (saveCustomer, saveInvoice, etc). Those run inside
// event handlers, not React render, so they can't call the useSession()
// hook - they read this instead. Returns null before the initial
// getSession() resolves or when signed out; every mutation function checks
// for that and throws rather than silently writing rows with no owner.
export function getCurrentUserId(): string | null {
  return session?.user.id ?? null;
}

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
