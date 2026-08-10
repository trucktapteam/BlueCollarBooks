import { DarkTheme, DefaultTheme, Stack, ThemeProvider, router } from 'expo-router';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { useAuthInitialized, useSession } from '@/data/authStore';

export default function TabLayout() {
  const colorScheme = useColorScheme();
  const session = useSession();
  // Supabase's getSession() is async, so there's a brief window on first
  // load where we genuinely don't know yet whether the user is signed in.
  // Gating the redirect on this (instead of just `!session`) stops every
  // page load from flashing to /login before the real answer comes back.
  const authInitialized = useAuthInitialized();

  useEffect(() => {
    if (authInitialized && !session) {
      router.replace('/login');
    }
  }, [authInitialized, session]);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AnimatedSplashOverlay />
      <Stack screenOptions={{ headerShown: false }} />
    </ThemeProvider>
  );
}
