import { createClient } from '@supabase/supabase-js';

// EXPO_PUBLIC_ vars are inlined into the client bundle at build time - see
// Expo's docs on environment variables. That's fine here: this is the
// publishable/anon key, which is meant to be public and is only as safe as
// the Row Level Security policies behind it (see the Supabase migrations
// for this project - every table is scoped to auth.uid() = user_id).
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  // eslint-disable-next-line no-console
  console.error(
    'Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY. Check your .env file and restart the dev server.'
  );
}

// Web is this app's primary target (see CLAUDE.md), and supabase-js defaults
// to window.localStorage for session persistence there with no extra setup.
// Native (iOS/Android) session persistence would need an AsyncStorage
// adapter - not wired up yet since it's out of scope while web is primary.
export const supabase = createClient(supabaseUrl ?? '', supabaseAnonKey ?? '', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});
