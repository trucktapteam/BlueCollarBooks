import Head from 'expo-router/head';
import { useState } from 'react';
import { ActivityIndicator, Image, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';

import { signOut, useSession } from '@/data/authStore';
import { useSubscription } from '@/data/subscriptionStore';

const defaultLogo = require('@/assets/images/blue-collar-books-logo.png');

// Shown when a signed-in user has no active trial/subscription - either
// they're brand new, or their trial/subscription lapsed. See _layout.tsx
// for the redirect logic that sends people here.
export default function SubscribeScreen() {
  const session = useSession();
  const subscription = useSubscription();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const lapsed = subscription && subscription.status !== 'none';

  async function handleStartTrial() {
    setErrorMessage('');
    setIsSubmitting(true);
    try {
      // Reuse the session already held by authStore (the same one that let
      // this screen render in the first place) instead of re-fetching it -
      // a fresh supabase.auth.getSession() call here raced with session
      // hydration on first load and intermittently came back empty.
      const token = session?.access_token;
      if (!token) {
        throw new Error('You need to be signed in.');
      }

      const response = await fetch('/api/create-checkout-session', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const body = await response.json();
      if (!response.ok || !body.url) {
        throw new Error(body.error ?? 'Could not start checkout.');
      }

      window.location.href = body.url;
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Something went wrong. Try again.');
      setIsSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <Head>
        <title>Start Your Trial | Blue Collar Books</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <View style={styles.centerContainer}>
        <View style={styles.card}>
          <Image source={defaultLogo} style={styles.cardLogo} />
          <Text style={styles.title}>{lapsed ? 'Your subscription needs attention' : 'Start your free trial'}</Text>
          <Text style={styles.helper}>
            {lapsed
              ? 'Your Blue Collar Books subscription is inactive. Start a new one to get back in.'
              : '30 days free, then $20/month. Cancel any time from Settings.'}
          </Text>

          {!!errorMessage && <Text style={styles.errorText}>{errorMessage}</Text>}

          <Pressable
            style={[styles.primaryButton, isSubmitting && styles.primaryButtonDisabled]}
            onPress={handleStartTrial}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <ActivityIndicator color="#111111" />
            ) : (
              <Text style={styles.primaryButtonText}>{lapsed ? 'Subscribe — $20/month' : 'Start 30-Day Free Trial'}</Text>
            )}
          </Pressable>

          <Pressable style={styles.switchModeButton} onPress={() => signOut()}>
            <Text style={styles.switchModeText}>Sign out</Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#121212' },
  centerContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  card: {
    width: 560,
    backgroundColor: '#1e1e1e',
    borderColor: '#323232',
    borderRadius: 18,
    borderWidth: 1,
    padding: 28,
    position: 'relative',
  },
  title: { color: '#fff', fontSize: 20, fontWeight: '900', marginBottom: 6 },
  helper: { color: '#a3a3a3', fontSize: 12, marginBottom: 16 },
  errorText: { color: '#ff6b6b', fontSize: 13, fontWeight: '700', marginBottom: 12 },
  primaryButton: {
    marginTop: 4,
    backgroundColor: '#ff7a00',
    borderRadius: 10,
    padding: 12,
    alignItems: 'center',
  },
  primaryButtonDisabled: { opacity: 0.6 },
  primaryButtonText: { color: '#111111', fontWeight: '800' },
  switchModeButton: { marginTop: 14, alignItems: 'center' },
  switchModeText: { color: '#a3a3a3', fontSize: 13, fontWeight: '700' },
  cardLogo: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 144,
    height: 54,
    resizeMode: 'contain',
    opacity: 0.95,
  },
});
