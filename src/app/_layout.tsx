import { DarkTheme, DefaultTheme, Stack, ThemeProvider, router } from 'expo-router';
import { useEffect } from 'react';
import { useColorScheme } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';

export default function TabLayout() {
  const colorScheme = useColorScheme();

  useEffect(() => {
    try {
      if (typeof window !== 'undefined') {
        const logged = window.localStorage.getItem('bcb_dev_logged_in') === 'true';
        if (!logged) {
          // If not already on /login, redirect there.
          // `router.replace` is fine for initial navigation.
          router.replace('/login');
        }
      }
    } catch {
      // ignore
    }
  }, []);

  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <AnimatedSplashOverlay />
      <Stack screenOptions={{ headerShown: false }} />
    </ThemeProvider>
  );
}
