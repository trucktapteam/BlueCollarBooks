import { router } from 'expo-router';
import Head from 'expo-router/head';
import { Image, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';

import { BrandColors } from '@/constants/theme';

const defaultLogo = require('@/assets/images/blue-collar-books-logo.jpg');

// Public, always-accessible route (see the isAlwaysPublic check in
// _layout.tsx) - linked from the marketing homepage footer. Basic,
// plain-language placeholder copy; not a substitute for a policy reviewed
// by an actual lawyer, which Thomas should get before relying on this for
// compliance purposes.
export default function PrivacyScreen() {
  return (
    <SafeAreaView style={styles.screen}>
      <Head>
        <title>Privacy Policy | Blue Collar Books</title>
        <meta name="description" content="How Blue Collar Books stores and handles your business data." />
        <link rel="canonical" href="https://www.bluecollarbookspro.com/privacy" />
        <meta name="robots" content="index, follow" />
      </Head>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.nav}>
          <Pressable onPress={() => router.push('/')}>
            <Image source={defaultLogo} style={styles.navLogo} />
          </Pressable>
        </View>

        <View style={styles.content}>
          <Text style={styles.heading}>Privacy Policy</Text>
          <Text style={styles.updated}>Last updated August 2026</Text>

          <Text style={styles.paragraph}>
            Blue Collar Books stores the business data you enter - invoices, expenses, customers, and bank account
            information you add - so the app can work for you. That data is yours. We don't sell it, and we don't
            share it with advertisers.
          </Text>
          <Text style={styles.paragraph}>
            We use Supabase to store your account and business data, and Stripe to process subscription payments.
            Neither has access to your data beyond what's needed to run those services.
          </Text>
          <Text style={styles.paragraph}>
            We collect basic account information (email address) to run your login and billing. We don't track you
            across other sites or sell your information to third parties.
          </Text>
          <Text style={styles.paragraph}>
            Questions about your data? Reach out to trucktapteam@gmail.com.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BrandColors.background },
  scrollContent: { paddingBottom: 64 },
  nav: { paddingHorizontal: 32, paddingTop: 24 },
  navLogo: { width: 160, height: 60, resizeMode: 'contain' },
  content: { maxWidth: 680, alignSelf: 'center', paddingHorizontal: 24, paddingTop: 48, width: '100%' },
  heading: { color: '#f4f1ec', fontSize: 32, fontWeight: '900', marginBottom: 8 },
  updated: { color: BrandColors.muted, fontSize: 13, fontWeight: '700', marginBottom: 32 },
  paragraph: { color: BrandColors.label, fontSize: 16, fontWeight: '500', lineHeight: 26, marginBottom: 20 },
});
