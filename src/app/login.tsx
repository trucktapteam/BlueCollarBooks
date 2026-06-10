import { router } from 'expo-router';
import { useState } from 'react';
import { Image, Pressable, SafeAreaView, StyleSheet, Text, TextInput, View } from 'react-native';

const defaultLogo = require('@/assets/images/blue-collar-books-logo.jpg');

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  function handleSignIn() {
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('bcb_dev_logged_in', 'true');
      }
    } catch {
      // ignore
    }

    router.replace('/');
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.centerContainer}>
        <View style={styles.card}>
          <Image source={defaultLogo} style={styles.cardLogo} />
          <Text style={styles.title}>Sign in to Blue Collar Books</Text>
          <Text style={styles.helper}>Local dev login only. No real authentication yet.</Text>

          <View style={styles.field}>
            <Text style={styles.label}>Email</Text>
            <TextInput style={styles.input} value={email} onChangeText={setEmail} keyboardType="email-address" />
          </View>

          <View style={styles.field}>
            <Text style={styles.label}>Password</Text>
            <TextInput style={styles.input} value={password} onChangeText={setPassword} secureTextEntry />
          </View>

          <Pressable style={styles.primaryButton} onPress={handleSignIn}>
            <Text style={styles.primaryButtonText}>Sign In</Text>
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
  primaryButton: { marginTop: 12, backgroundColor: '#f97316', borderRadius: 10, padding: 12, alignItems: 'center' },
  primaryButtonText: { color: '#fff', fontWeight: '800' },
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
