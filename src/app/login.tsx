import { router, useLocalSearchParams } from 'expo-router';
import Head from 'expo-router/head';
import { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';

import { signInWithPassword } from '@/data/authStore';
import { supabase } from '@/lib/supabase';

const defaultLogo = require('@/assets/images/blue-collar-books-logo.png');

type WaitlistStatus = 'idle' | 'submitting' | 'success' | 'error';

// Supabase Auth has new signups disabled at the project level (see
// CLAUDE.md / project notes) - that's the actual mechanism preventing new
// accounts, and it's untouched here. Since that block is always on right
// now, "Create Account" leads straight to this waitlist card instead of a
// password form that would just fail on submit - no point making someone
// fill in a password for an account that can't be created, then hitting
// them with an error that asks for their email a second time.
function ComingSoonWaitlist({ onBackToSignIn }: { onBackToSignIn: () => void }) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<WaitlistStatus>('idle');
  const [errorText, setErrorText] = useState('');

  async function handleSubmit() {
    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setStatus('error');
      setErrorText('Enter an email address.');
      return;
    }

    setStatus('submitting');
    setErrorText('');

    const { error } = await supabase.from('waitlist_emails').insert({ email: trimmedEmail });

    if (error) {
      // Postgres unique-violation on the case-insensitive email index -
      // treat "already on the list" as a success state, not an error.
      if (error.code === '23505') {
        setStatus('success');
        return;
      }

      setStatus('error');
      setErrorText('Something went wrong. Please try again.');
      return;
    }

    setStatus('success');
  }

  if (status === 'success') {
    return (
      <View style={styles.card}>
        <Image source={defaultLogo} style={styles.comingSoonLogo} />
        <Text style={styles.title}>Thanks, we'll be in touch!</Text>
        <Text style={styles.helper}>We'll email you the moment Blue Collar Books is ready.</Text>

        <Pressable style={styles.switchModeButton} onPress={onBackToSignIn}>
          <Text style={styles.switchModeText}>Already have an account? Sign In</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Image source={defaultLogo} style={styles.comingSoonLogo} />
      <Text style={styles.title}>Coming Soon</Text>
      <Text style={styles.helper}>
        Blue Collar Books is currently in active development. Leave your email and we'll notify you the moment it's
        ready.
      </Text>

      <View style={styles.field}>
        <Text style={styles.label}>Email</Text>
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          placeholder="you@example.com"
          placeholderTextColor="#6b6b6b"
          editable={status !== 'submitting'}
        />
      </View>

      {status === 'error' && !!errorText && <Text style={styles.errorText}>{errorText}</Text>}

      <Pressable
        style={[styles.primaryButton, status === 'submitting' && styles.primaryButtonDisabled]}
        onPress={handleSubmit}
        disabled={status === 'submitting'}
      >
        {status === 'submitting' ? (
          <ActivityIndicator color="#111111" />
        ) : (
          <Text style={styles.primaryButtonText}>Submit</Text>
        )}
      </Pressable>

      <Pressable style={styles.switchModeButton} onPress={onBackToSignIn}>
        <Text style={styles.switchModeText}>Already have an account? Sign In</Text>
      </Pressable>
    </View>
  );
}

export default function LoginScreen() {
  // The marketing homepage's "Start Free Trial" button links here with
  // ?mode=signup so people land straight on the Coming Soon waitlist
  // instead of Sign In - that button's whole point was to start a trial,
  // and since signups are disabled, waitlist is the closest thing to that.
  const { mode: modeParam } = useLocalSearchParams<{ mode?: string }>();
  const { width } = useWindowDimensions();
  const isCompact = width < 500;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>(modeParam === 'signup' ? 'sign-up' : 'sign-in');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  async function handleSubmit() {
    setErrorMessage('');

    if (!email.trim() || !password) {
      setErrorMessage('Enter an email and password.');
      return;
    }

    setIsSubmitting(true);

    try {
      await signInWithPassword(email.trim(), password);
      router.replace('/dashboard');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Something went wrong. Try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <Head>
        <title>Sign In | Blue Collar Books</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <View style={styles.centerContainer}>
        {mode === 'sign-up' ? (
          <ComingSoonWaitlist onBackToSignIn={() => setMode('sign-in')} />
        ) : (
          <View style={styles.card}>
            {!isCompact && <Image source={defaultLogo} style={styles.cardLogo} />}
            {isCompact && <Image source={defaultLogo} style={styles.cardLogoCompact} />}
            <Text style={[styles.title, isCompact && styles.titleCompact]}>Sign in to Blue Collar Books</Text>
            <Text style={styles.helper}>First time here? Use Create Account below.</Text>

            <View style={styles.field}>
              <Text style={styles.label}>Email</Text>
              <TextInput
                style={styles.input}
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                placeholder="you@example.com"
                placeholderTextColor="#6b6b6b"
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Password</Text>
              <TextInput
                style={styles.input}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                placeholderTextColor="#6b6b6b"
              />
            </View>

            {!!errorMessage && <Text style={styles.errorText}>{errorMessage}</Text>}

            <Pressable
              style={[styles.primaryButton, isSubmitting && styles.primaryButtonDisabled]}
              onPress={handleSubmit}
              disabled={isSubmitting}
            >
              {isSubmitting ? <ActivityIndicator color="#111111" /> : <Text style={styles.primaryButtonText}>Sign In</Text>}
            </Pressable>

            <Pressable
              style={styles.switchModeButton}
              onPress={() => {
                setMode('sign-up');
                setErrorMessage('');
              }}
            >
              <Text style={styles.switchModeText}>Don't have an account? Create Account</Text>
            </Pressable>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#121212' },
  logoWrapper: { alignItems: 'center', paddingTop: 48 },
  logo: { width: 140, height: 56, resizeMode: 'contain' },
  centerContainer: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  card: {
    width: '100%',
    maxWidth: 560,
    backgroundColor: '#1e1e1e',
    borderColor: '#323232',
    borderRadius: 18,
    borderWidth: 1,
    padding: 28,
    position: 'relative',
  },
  title: { color: '#fff', fontSize: 20, fontWeight: '900', marginBottom: 6 },
  titleCompact: { marginTop: 4 },
  helper: { color: '#a3a3a3', fontSize: 12, marginBottom: 12 },
  field: { marginBottom: 12 },
  label: { color: '#a3a3a3', fontSize: 12, marginBottom: 6 },
  input: {
    backgroundColor: '#252525',
    borderColor: '#353535',
    borderRadius: 10,
    borderWidth: 1,
    color: '#ffffff',
    padding: 12,
  },
  errorText: { color: '#ff6b6b', fontSize: 13, fontWeight: '700', marginBottom: 12 },
  confirmText: { color: '#7fd884', fontSize: 13, fontWeight: '700', marginBottom: 12 },
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
  cardLogoCompact: {
    width: 120,
    height: 46,
    resizeMode: 'contain',
    opacity: 0.95,
    marginBottom: 8,
  },
  comingSoonLogo: {
    width: 120,
    height: 46,
    resizeMode: 'contain',
    opacity: 0.95,
    marginBottom: 12,
  },
});
