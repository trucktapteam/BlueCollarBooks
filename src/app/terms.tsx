import { router } from 'expo-router';
import { Image, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';

import { BrandColors } from '@/constants/theme';

const defaultLogo = require('@/assets/images/blue-collar-books-logo.jpg');

// Public, always-accessible route (see the isAlwaysPublic check in
// _layout.tsx) - linked from the marketing homepage footer. Basic,
// plain-language placeholder copy; not a substitute for terms reviewed by
// an actual lawyer, which Thomas should get before relying on this for
// compliance purposes.
export default function TermsScreen() {
  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.nav}>
          <Pressable onPress={() => router.push('/')}>
            <Image source={defaultLogo} style={styles.navLogo} />
          </Pressable>
        </View>

        <View style={styles.content}>
          <Text style={styles.heading}>Terms of Service</Text>
          <Text style={styles.updated}>Last updated August 2026</Text>

          <Text style={styles.paragraph}>
            Blue Collar Books is bookkeeping and invoicing software billed at $20/month after a 30-day free trial.
            You can cancel any time from Settings - your account stays active through the end of the period you've
            already paid for.
          </Text>
          <Text style={styles.paragraph}>
            You're responsible for the accuracy of the data you enter. Blue Collar Books is a tool to help you track
            your business - it doesn't replace an accountant or tax professional.
          </Text>
          <Text style={styles.paragraph}>
            The service is provided as-is, without warranties of any kind. We'll do our best to keep it running and
            your data safe, but we're not liable for losses arising from its use.
          </Text>
          <Text style={styles.paragraph}>
            Questions? Reach out to trucktapteam@gmail.com.
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
