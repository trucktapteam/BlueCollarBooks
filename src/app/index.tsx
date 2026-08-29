import { router } from 'expo-router';
import { Image, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { BrandColors } from '@/constants/theme';

const defaultLogo = require('@/assets/images/blue-collar-books-logo.jpg');

// Public marketing homepage - lives at "/" and is the one route in this app
// that renders for signed-out visitors instead of bouncing to /login (see
// the isPublicRoute check in _layout.tsx). Everything below it (dashboard,
// invoices, etc.) still requires a real session.
//
// Deliberately not the standard centered-hero / 2x2-card-grid / centered-
// pricing-card template every AI-generated SaaS page defaults to - that
// layout is instantly recognizable as generic. This uses an asymmetric
// hero with a real product preview (built from the app's own dashboard
// tiles, not a stock screenshot), a numbered editorial feature list
// instead of symmetric cards, and a banner-style pricing strip instead of
// a centered pricing card.
const features = [
  {
    number: '01',
    title: 'Invoicing',
    body: "Send a clean invoice with your logo on it, track who's paid and who isn't, stop chasing paper.",
  },
  {
    number: '02',
    title: 'Expense tracking',
    body: 'Log fuel, repairs, permits, and every write-off as it happens - not scrambling at tax time.',
  },
  {
    number: '03',
    title: 'Cash position',
    body: "See what's actually in the bank and who owes you, in one glance, no math in your head.",
  },
  {
    number: '04',
    title: 'Reports',
    body: 'Pull what your accountant needs in a couple clicks, not a shoebox full of receipts.',
  },
];

const previewTiles = [
  { label: 'Cash Available', value: '$18,240' },
  { label: 'Waiting To Be Paid', value: '$4,120' },
  { label: 'Paid This Month', value: '$11,600' },
];

export default function WelcomeScreen() {
  const { width } = useWindowDimensions();
  const isCompact = width < 900;

  const goToSignup = () => router.push({ pathname: '/login', params: { mode: 'signup' } });

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.nav}>
          <Image source={defaultLogo} style={styles.navLogo} />
          <Pressable style={styles.navSignIn} onPress={() => router.push('/login')}>
            <Text style={styles.navSignInText}>Sign In</Text>
          </Pressable>
        </View>

        <View style={[styles.hero, isCompact && styles.heroCompact]}>
          <View style={[styles.heroCopy, isCompact && styles.heroCopyCompact]}>
            <Text style={styles.eyebrow}>BOOKKEEPING FOR OWNER-OPERATORS</Text>
            <Text style={[styles.headline, isCompact && styles.headlineCompact]}>
              Your books, done{'\n'}between loads.
            </Text>
            <Text style={styles.subhead}>
              Invoices, expenses, and cash flow — built for people who run trucks, not spreadsheets.
            </Text>

            <View style={styles.ctaRow}>
              <Pressable style={styles.primaryButton} onPress={goToSignup}>
                <Text style={styles.primaryButtonText}>Start 30-Day Free Trial</Text>
              </Pressable>
              <Pressable style={styles.secondaryButton} onPress={() => router.push('/login')}>
                <Text style={styles.secondaryButtonText}>Sign In</Text>
              </Pressable>
            </View>
            <Text style={styles.ctaHelper}>No credit card scams. $20/month after your trial, cancel any time.</Text>
          </View>

          <View style={[styles.previewWrap, isCompact && styles.previewWrapCompact]}>
            <View style={styles.previewCard}>
              <View style={styles.previewHeaderRow}>
                <View style={styles.previewDot} />
                <Text style={styles.previewHeaderText}>Shop Dashboard</Text>
              </View>
              <Text style={styles.previewHeroLabel}>Profit This Month</Text>
              <Text style={styles.previewHeroValue}>$6,540</Text>
              <View style={styles.previewTileRow}>
                {previewTiles.map((tile) => (
                  <View key={tile.label} style={styles.previewTile}>
                    <Text style={styles.previewTileLabel}>{tile.label}</Text>
                    <Text style={styles.previewTileValue}>{tile.value}</Text>
                  </View>
                ))}
              </View>
            </View>
          </View>
        </View>

        <View style={styles.divider} />

        <View style={styles.featuresSection}>
          <Text style={styles.sectionEyebrow}>WHAT YOU GET</Text>
          <View style={styles.featuresList}>
            {features.map((feature, index) => (
              <View
                key={feature.title}
                style={[styles.featureRow, index === features.length - 1 && styles.featureRowLast]}
              >
                <Text style={styles.featureNumber}>{feature.number}</Text>
                <View style={styles.featureText}>
                  <Text style={styles.featureTitle}>{feature.title}</Text>
                  <Text style={styles.featureBody}>{feature.body}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        <View style={[styles.pricingBanner, isCompact && styles.pricingBannerCompact]}>
          <View style={styles.pricingBannerAccent} />
          <View style={[styles.pricingLeft, isCompact && styles.pricingLeftCompact]}>
            <Text style={styles.pricingAmount}>
              $20<Text style={styles.pricingPeriod}>/month</Text>
            </Text>
            <Text style={styles.pricingDetail}>First 30 days free. Cancel any time. No contracts.</Text>
          </View>
          <Pressable style={styles.pricingButton} onPress={goToSignup}>
            <Text style={styles.primaryButtonText}>Start Free Trial</Text>
          </Pressable>
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 56,
    maxWidth: 1160,
    alignSelf: 'center',
    paddingHorizontal: 32,
    paddingTop: 72,
    paddingBottom: 64,
    width: '100%',
  },
  heroCompact: {
    flexDirection: 'column',
    paddingTop: 48,
  },
  heroCopy: {
    flex: 1,
  },
  heroCopyCompact: {
    width: '100%',
  },
  eyebrow: {
    color: BrandColors.orange,
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: 18,
  },
  headline: {
    color: '#ffffff',
    fontSize: 56,
    fontWeight: '900',
    lineHeight: 60,
  },
  headlineCompact: {
    fontSize: 38,
    lineHeight: 44,
  },
  subhead: {
    color: BrandColors.label,
    fontSize: 19,
    fontWeight: '600',
    marginTop: 22,
    maxWidth: 480,
  },
  ctaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    marginTop: 36,
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
    marginTop: 18,
  },
  previewWrap: {
    flex: 1,
    alignItems: 'center',
  },
  previewWrapCompact: {
    width: '100%',
    marginTop: 48,
  },
  previewCard: {
    backgroundColor: BrandColors.card,
    borderColor: BrandColors.orangeBorder,
    borderRadius: 24,
    borderWidth: 1,
    maxWidth: 420,
    padding: 28,
    shadowColor: BrandColors.orange,
    shadowOffset: { width: 0, height: 22 },
    shadowOpacity: 0.2,
    shadowRadius: 40,
    transform: [{ rotate: '-2.5deg' }],
    width: '100%',
  },
  previewHeaderRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 8,
    marginBottom: 20,
  },
  previewDot: {
    backgroundColor: BrandColors.orange,
    borderRadius: 5,
    height: 10,
    width: 10,
  },
  previewHeaderText: {
    color: BrandColors.muted,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 0.6,
  },
  previewHeroLabel: {
    color: BrandColors.label,
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 8,
  },
  previewHeroValue: {
    color: '#ffffff',
    fontSize: 42,
    fontWeight: '900',
    marginBottom: 24,
  },
  previewTileRow: {
    gap: 12,
  },
  previewTile: {
    alignItems: 'center',
    backgroundColor: BrandColors.field,
    borderColor: BrandColors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  previewTileLabel: {
    color: BrandColors.label,
    fontSize: 13,
    fontWeight: '700',
  },
  previewTileValue: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '900',
  },
  divider: {
    alignSelf: 'center',
    backgroundColor: BrandColors.orange,
    height: 3,
    marginVertical: 8,
    transform: [{ rotate: '-1deg' }],
    width: 120,
  },
  featuresSection: {
    maxWidth: 760,
    alignSelf: 'center',
    paddingHorizontal: 24,
    paddingTop: 48,
    width: '100%',
  },
  sectionEyebrow: {
    color: BrandColors.orange,
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 1.2,
    marginBottom: 28,
  },
  featuresList: {
    width: '100%',
  },
  featureRow: {
    borderBottomColor: BrandColors.borderSubtle,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 24,
    paddingVertical: 28,
  },
  featureRowLast: {
    borderBottomWidth: 0,
  },
  featureNumber: {
    color: BrandColors.orangeBorder,
    fontSize: 40,
    fontWeight: '900',
    minWidth: 64,
  },
  featureText: {
    flex: 1,
  },
  featureTitle: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 8,
  },
  featureBody: {
    color: BrandColors.label,
    fontSize: 16,
    fontWeight: '500',
    lineHeight: 24,
  },
  pricingBanner: {
    alignItems: 'center',
    backgroundColor: BrandColors.cardRaised,
    borderColor: BrandColors.orangeBorder,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginHorizontal: 24,
    marginTop: 64,
    maxWidth: 1040,
    alignSelf: 'center',
    overflow: 'hidden',
    padding: 36,
    position: 'relative',
    width: '90%',
  },
  pricingBannerCompact: {
    alignItems: 'flex-start',
    flexDirection: 'column',
    gap: 24,
  },
  pricingBannerAccent: {
    backgroundColor: BrandColors.orangeSoft,
    height: 240,
    position: 'absolute',
    right: -60,
    top: -60,
    transform: [{ rotate: '18deg' }],
    width: 240,
  },
  pricingLeft: {
    zIndex: 1,
  },
  pricingLeftCompact: {
    width: '100%',
  },
  pricingAmount: {
    color: '#ffffff',
    fontSize: 48,
    fontWeight: '900',
  },
  pricingPeriod: {
    color: BrandColors.muted,
    fontSize: 18,
    fontWeight: '700',
  },
  pricingDetail: {
    color: BrandColors.label,
    fontSize: 15,
    fontWeight: '600',
    marginTop: 8,
  },
  pricingButton: {
    alignItems: 'center',
    backgroundColor: BrandColors.orange,
    borderRadius: 12,
    paddingHorizontal: 32,
    paddingVertical: 16,
    zIndex: 1,
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
