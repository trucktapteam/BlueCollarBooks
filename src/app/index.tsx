import { router } from 'expo-router';
import { Image, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { BrandColors } from '@/constants/theme';

const defaultLogo = require('@/assets/images/blue-collar-books-logo.jpg');

// Public marketing homepage - lives at "/" and is the one route in this app
// that renders for signed-out visitors instead of bouncing to /login (see
// the isPublicRoute check in _layout.tsx). Everything below it (dashboard,
// invoices, etc.) still requires a real session.
const features = [
  {
    title: 'Invoicing',
    body: "Send a clean invoice with your logo on it, track who's paid and who isn't, and stop chasing paper.",
  },
  {
    title: 'Expense tracking',
    body: 'Log fuel, repairs, permits, and every write-off as it happens - not scrambling at tax time.',
  },
  {
    title: 'Cash position',
    body: "See what's actually in the bank and who owes you, in one glance, without doing math in your head.",
  },
  {
    title: 'Reports',
    body: 'Pull what your accountant needs in a couple clicks, not a shoebox full of receipts.',
  },
];

export default function WelcomeScreen() {
  const { width } = useWindowDimensions();
  const isCompact = width < 760;

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.nav}>
          <Image source={defaultLogo} style={styles.navLogo} />
          <Pressable style={styles.navSignIn} onPress={() => router.push('/login')}>
            <Text style={styles.navSignInText}>Sign In</Text>
          </Pressable>
        </View>

        <View style={styles.hero}>
          <Text style={styles.eyebrow}>BOOKKEEPING FOR OWNER-OPERATORS</Text>
          <Text style={[styles.headline, isCompact && styles.headlineCompact]}>
            Track your money without leaving the cab.
          </Text>
          <Text style={styles.subhead}>
            Invoices, expenses, and cash flow - built for people who run trucks, not spreadsheets.
          </Text>

          <View style={[styles.ctaRow, isCompact && styles.ctaRowCompact]}>
            <Pressable
              style={styles.primaryButton}
              onPress={() => router.push({ pathname: '/login', params: { mode: 'signup' } })}
            >
              <Text style={styles.primaryButtonText}>Start 30-Day Free Trial</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={() => router.push('/login')}>
              <Text style={styles.secondaryButtonText}>Sign In</Text>
            </Pressable>
          </View>
          <Text style={styles.ctaHelper}>No credit card scams, no hidden fees. Just $20/month after your trial.</Text>
        </View>

        <View style={styles.featuresSection}>
          <Text style={styles.sectionHeading}>What you get</Text>
          <View style={[styles.featuresGrid, isCompact && styles.featuresGridCompact]}>
            {features.map((feature) => (
              <View key={feature.title} style={[styles.featureCard, isCompact && styles.featureCardCompact]}>
                <Text style={styles.featureTitle}>{feature.title}</Text>
                <Text style={styles.featureBody}>{feature.body}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={styles.pricingSection}>
          <Text style={styles.sectionHeading}>Straightforward pricing</Text>
          <View style={styles.pricingCard}>
            <Text style={styles.pricingAmount}>$20<Text style={styles.pricingPeriod}>/month</Text></Text>
            <Text style={styles.pricingDetail}>First 30 days free. Cancel any time. No contracts, no surprise fees.</Text>
            <Pressable
              style={styles.pricingButton}
              onPress={() => router.push({ pathname: '/login', params: { mode: 'signup' } })}
            >
              <Text style={styles.primaryButtonText}>Start Free Trial</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>Blue Collar Books</Text>
          <Pressable onPress={() => router.push('/login')}>
            <Text style={styles.footerLink}>Sign In</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: BrandColors.background },
  scrollContent: { paddingBottom: 48 },
  nav: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 32,
    paddingTop: 24,
  },
  navLogo: { width: 160, height: 60, resizeMode: 'contain' },
  navSignIn: {
    borderColor: BrandColors.border,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  navSignInText: { color: '#ffffff', fontSize: 14, fontWeight: '700' },
  hero: {
    alignItems: 'center',
    maxWidth: 760,
    alignSelf: 'center',
    paddingHorizontal: 24,
    paddingTop: 64,
    paddingBottom: 56,
  },
  eyebrow: {
    color: BrandColors.orange,
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: 16,
    textAlign: 'center',
  },
  headline: {
    color: '#ffffff',
    fontSize: 52,
    fontWeight: '900',
    lineHeight: 58,
    textAlign: 'center',
  },
  headlineCompact: {
    fontSize: 34,
    lineHeight: 40,
  },
  subhead: {
    color: BrandColors.label,
    fontSize: 19,
    fontWeight: '600',
    marginTop: 20,
    maxWidth: 560,
    textAlign: 'center',
  },
  ctaRow: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 36,
  },
  ctaRowCompact: {
    flexDirection: 'column',
    width: '100%',
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: BrandColors.orange,
    borderRadius: 12,
    paddingHorizontal: 28,
    paddingVertical: 16,
  },
  primaryButtonText: { color: '#111111', fontSize: 16, fontWeight: '900' },
  secondaryButton: {
    alignItems: 'center',
    borderColor: BrandColors.border,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 28,
    paddingVertical: 16,
  },
  secondaryButtonText: { color: '#ffffff', fontSize: 16, fontWeight: '800' },
  ctaHelper: {
    color: BrandColors.muted,
    fontSize: 13,
    fontWeight: '600',
    marginTop: 16,
    textAlign: 'center',
  },
  featuresSection: {
    borderTopColor: BrandColors.borderSubtle,
    borderTopWidth: 1,
    maxWidth: 1040,
    alignSelf: 'center',
    paddingHorizontal: 24,
    paddingTop: 56,
    width: '100%',
  },
  sectionHeading: {
    color: '#ffffff',
    fontSize: 28,
    fontWeight: '900',
    marginBottom: 28,
    textAlign: 'center',
  },
  featuresGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 20,
    justifyContent: 'center',
  },
  featuresGridCompact: {
    flexDirection: 'column',
  },
  featureCard: {
    backgroundColor: BrandColors.card,
    borderColor: BrandColors.border,
    borderRadius: 20,
    borderWidth: 1,
    flexBasis: '46%',
    flexGrow: 1,
    padding: 24,
  },
  featureCardCompact: {
    flexBasis: '100%',
  },
  featureTitle: {
    color: BrandColors.orange,
    fontSize: 18,
    fontWeight: '800',
    marginBottom: 10,
  },
  featureBody: {
    color: BrandColors.label,
    fontSize: 15,
    fontWeight: '500',
    lineHeight: 22,
  },
  pricingSection: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 64,
  },
  pricingCard: {
    alignItems: 'center',
    backgroundColor: BrandColors.cardRaised,
    borderColor: BrandColors.orangeBorder,
    borderRadius: 24,
    borderWidth: 1,
    maxWidth: 420,
    padding: 36,
    width: '100%',
  },
  pricingAmount: {
    color: '#ffffff',
    fontSize: 56,
    fontWeight: '900',
  },
  pricingPeriod: {
    color: BrandColors.muted,
    fontSize: 20,
    fontWeight: '700',
  },
  pricingDetail: {
    color: BrandColors.label,
    fontSize: 15,
    fontWeight: '600',
    marginTop: 12,
    marginBottom: 28,
    textAlign: 'center',
  },
  pricingButton: {
    alignItems: 'center',
    backgroundColor: BrandColors.orange,
    borderRadius: 12,
    paddingHorizontal: 32,
    paddingVertical: 16,
    width: '100%',
  },
  footer: {
    alignItems: 'center',
    borderTopColor: BrandColors.borderSubtle,
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 64,
    paddingHorizontal: 32,
    paddingTop: 24,
  },
  footerText: { color: BrandColors.muted, fontSize: 13, fontWeight: '700' },
  footerLink: { color: BrandColors.orange, fontSize: 13, fontWeight: '800' },
});
