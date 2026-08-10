import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Image, Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from 'react-native';

import { signInWithPassword, signUpWithPassword } from '@/data/authStore';

const defaultLogo = require('@/assets/images/blue-collar-books-logo.jpg');

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'sign-in' | 'sign-up'>('sign-in');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [confirmMessage, setConfirmMessage] = useState('');

  async function handleSubmit() {
    setErrorMessage('');
    setConfirmMessage('');

    if (!email.trim() || !password) {
      setErrorMessage('Enter an email and password.');
      return;
    }

    setIsSubmitting(true);

    try {
      if (mode === 'sign-up') {
        await signUpWithPassword(email.trim(), password);
        setConfirmMessage('Account created. Check your email if confirmation is required, then sign in.');
        setMode('sign-in');
        return;
      }

      await signInWithPassword(email.trim(), password);
      router.replace('/');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Something went wrong. Try again.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.centerContainer}>
        <View style={styles.card}>
          <Image source={defaultLogo} style={styles.cardLogo} />
          <Text style={styles.title}>{mode === 'sign-in' ? 'Sign in to Blue Collar Books' : 'Create your account'}</Text>
          <Text style={styles.helper}>
            {mode === 'sign-in' ? 'First time here? Use Create Account below.' : 'One account is all this app needs right now.'}
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
            />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Password</Text>
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              placeholder={mode === 'sign-up' ? 'At least 6 characters' : ''}
              placeholderTextColor="#6b6b6b"
            />
          </View>

          {!!errorMessage && <Text style={styles.errorText}>{errorMessage}</Text>}
          {!!confirmMessage && <Text style={styles.confirmText}>{confirmMessage}</Text>}

          <Pressable
            style={[styles.primaryButton, isSubmitting && styles.primaryButtonDisabled]}
            onPress={handleSubmit}
            disabled={isSubmitting}
          >
            {isSubmitting ? (
              <ActivityIndicator color="#111111" />
            ) : (
              <Text style={styles.primaryButtonText}>{mode === 'sign-in' ? 'Sign In' : 'Create Account'}</Text>
            )}
          </Pressable>

          <Pressable
            style={styles.switchModeButton}
            onPress={() => {
              setMode((current) => (current === 'sign-in' ? 'sign-up' : 'sign-in'));
              setErrorMessage('');
              setConfirmMessage('');
            }}
          >
            <Text style={styles.switchModeText}>
              {mode === 'sign-in' ? "Don't have an account? Create Account" : 'Already have an account? Sign In'}
            </Text>
          </Pressable>
        </View>
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
    width: 560,
    backgroundColor: '#1e1e1e',
    borderColor: '#323232',
    borderRadius: 18,
    borderWidth: 1,
    padding: 28,
    position: 'relative',
  },
  title: { color: '#fff', fontSize: 20, fontWeight: '900', marginBottom: 6 },
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
});
