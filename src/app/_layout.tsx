import { DarkTheme, DefaultTheme, Stack, ThemeProvider, router, usePathname } from 'expo-router';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { useAuthInitialized, useSession } from '@/data/authStore';
import { hasAccess, useSubscription, useSubscriptionInitialized } from '@/data/subscriptionStore';
// Side-effect only import: registers the auth listener that loads/clears
// every data store when the signed-in user changes. See src/data/bootstrap.ts.
import '@/data/bootstrap';

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const session = useSession();
  // Supabase's getSession() is async, so there's a brief window on first
  // load where we genuinely don't know yet whether the user is signed in.
  // Gating the redirect on this (instead of just `!session`) stops every
  // page load from flashing to /login before the real answer comes back.
  const authInitialized = useAuthInitialized();
  const subscription = useSubscription();
  const subscriptionInitialized = useSubscriptionInitialized();
  const pathname = usePathname();

  // '/' is the public marketing/welcome page (see src/app/index.tsx) - it
  // needs to render for signed-out visitors instead of bouncing them to
  // /login like every other route does. '/login' is public by nature too.
  const isPublicRoute = pathname === '/' || pathname === '/login';
  // /privacy and /terms are linked from the marketing page footer and need
  // to stay viewable no matter who's looking - signed in or not - so they
  //'re excluded from both redirect checks below entirely.
  const isAlwaysPublicRoute = pathname === '/privacy' || pathname === '/terms';

  useEffect(() => {
    if (isAlwaysPublicRoute) {
      return;
    }

    if (authInitialized && !session) {
      if (!isPublicRoute) {
        router.replace('/login');
      }
      return;
    }

    // Someone who's already signed in doesn't need to see the marketing
    // page or the login form again - send them straight into the app.
    if (authInitialized && session && isPublicRoute) {
      router.replace('/dashboard');
      return;
    }

    // Same "wait for the real answer" pattern as the sign-in check above -
    // don't redirect to /subscribe until loadSubscription() has actually
    // resolved for this user, or every login would flash through it.
    if (
      authInitialized &&
      session &&
      subscriptionInitialized &&
      !hasAccess(subscription) &&
      pathname !== '/subscribe'
    ) {
      router.replace('/subscribe');
    }
  }, [authInitialized, session, subscription, subscriptionInitialized, pathname, isPublicRoute, isAlwaysPublicRoute]);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AnimatedSplashOverlay />
      <Stack screenOptions={{ headerShown: false }} />
    </ThemeProvider>
  );
}
