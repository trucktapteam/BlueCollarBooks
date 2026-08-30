import { router } from 'expo-router';
import Head from 'expo-router/head';
import { useEffect, useState } from 'react';
import { Image, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';

import { BrandColors } from '@/constants/theme';

// Expo's static web export (app.json web.output: "static") prerenders this
// route with no real browser present, so react-native's useWindowDimensions
// was coming back with a stale/default width after hydration on
// bluecollarbookspro.com - correct locally (Metro dev server always has a
// real window), broken only on the deployed build, where every isCompact
// check below stayed stuck "true" regardless of actual screen width. This
// reads window.innerWidth directly and re-syncs once on mount plus on
// resize, which sidesteps whatever the hook was doing wrong on that export
// path.
function useIsCompact(breakpoint: number) {
  const [isCompact, setIsCompact] = useState(() =>
    typeof window === 'undefined' ? false : window.innerWidth < breakpoint,
  );

  useEffect(() => {
    function syncWidth() {
      setIsCompact(window.innerWidth < breakpoint);
    }
    syncWidth();
    window.addEventListener('resize', syncWidth);
    return () => window.removeEventListener('resize', syncWidth);
  }, [breakpoint]);

  return isCompact;
}

const defaultLogo = require('@/assets/images/blue-collar-books-logo.png');

// Public marketing homepage - lives at "/" and is the one route in this app
// that renders for signed-out visitors instead of bouncing to /login (see
// the isPublicRoute check in _layout.tsx). Everything below it (dashboard,
// invoices, etc.) still requires a real session.
//
// Brand direction: clean work-truck-instrument-panel feel, not generic
// SaaS. Charcoal background, warm off-white headings (not stark white),
// orange used only where it means something, square-ish panels, flat
// shadows instead of glow, no stock imagery. See the brand brief this was
// built from for the full rationale.
const offWhite = '#f4f1ec';

// Illustrative example numbers for the instrument-panel preview - this is
// a mockup of what the real dashboard looks like (see src/app/dashboard.tsx
// for the actual thing), not live data.
const readouts = [
  { label: 'Cash Available', value: '$18,240', fill: 0.7 },
  { label: 'Money In', value: '$9,800', fill: 0.55 },
  { label: 'Money Out', value: '$3,260', fill: 0.3 },
  { label: 'Waiting To Be Paid', value: '$4,120', fill: 0.4 },
];

// Mirrors the real metric-card row on src/app/dashboard.tsx (same labels,
// icons, and accent colors) so the "YOUR BUSINESS. ONE DASHBOARD." section
// reads as an authentic preview of the actual product rather than a
// restatement of the hero numbers.
const productMetrics = [
  { label: 'Cash Available', icon: '💵', accent: BrandColors.green, value: '$18,240', helper: 'All accounts' },
  { label: 'Waiting To Be Paid', icon: '💰', accent: BrandColors.orange, value: '$4,120', helper: 'Open invoices' },
  { label: 'Money In', icon: '📈', accent: BrandColors.green, value: '$9,800', helper: 'This month' },
  { label: 'Money Out', icon: '🧾', accent: BrandColors.orange, value: '$3,260', helper: 'This month' },
];

const workbenchItems = [
  { title: 'INVOICING', body: 'Get paid without chasing paper.' },
  { title: 'EXPENSES', body: 'Know where the money went.' },
  { title: 'CASH POSITION', body: "Know what you've actually got." },
  { title: 'REPORTS', body: 'Give your accountant what they need.' },
  { title: 'CUSTOMERS', body: 'Keep the people you work for organized.' },
  { title: 'PAYMENTS', body: "See what's been paid and what's still outstanding." },
];

// Tick fan spans a full semicircle (-90deg to 90deg, i.e. 9 o'clock through
// 12 through 3 o'clock), each tick rotated around a shared pivot at the
// bottom-center of its box. This is restrained on purpose: no needle, no
// numerals printed on the dial face, no bezel - just a row of instrument
// ticks with the number doing the actual work underneath.
const gaugeTickAngles = [-90, -72, -54, -36, -18, 0, 18, 36, 54, 72, 90];

function GaugeReadout({ label, value, fill, compact }: { label: string; value: string; fill: number; compact?: boolean }) {
  const tickLength = compact ? 15 : 20;
  const tickWidth = compact ? 2 : 2.5;
  const arcWidth = tickLength * 2 + 22;
  const filledCount = Math.max(1, Math.round(fill * gaugeTickAngles.length));

  return (
    <View style={styles.gaugeTile}>
      <Text style={styles.gaugeLabel}>{label.toUpperCase()}</Text>
      <View style={[styles.gaugeArcBox, { width: arcWidth, height: tickLength + 6 }]}>
        {gaugeTickAngles.map((angle, index) => (
          <View
            key={angle}
            style={[
              styles.gaugeTick,
              {
                height: tickLength,
                width: tickWidth,
                marginLeft: -tickWidth / 2,
                backgroundColor: index < filledCount ? BrandColors.orange : BrandColors.borderSubtle,
                transform: [{ rotate: `${angle}deg` }],
              },
            ]}
          />
        ))}
      </View>
      <View style={[styles.gaugeBaseline, { width: arcWidth * 0.72 }]} />
      <Text style={[styles.gaugeValue, compact && styles.gaugeValueCompact]}>{value}</Text>
    </View>
  );
}

export default function WelcomeScreen() {
  const isCompact = useIsCompact(900);

  const goToSignup = () => router.push({ pathname: '/login', params: { mode: 'signup' } });

  return (
    <SafeAreaView style={styles.screen}>
      <Head>
        <title>Blue Collar Books | Bookkeeping for People Who Actually Work</title>
        <meta
          name="description"
          content="Invoicing, expenses, and cash flow for owner-operators and service trades. $20/month, 30 days free."
        />
        <link rel="canonical" href="https://www.bluecollarbookspro.com/" />
        <meta name="robots" content="index, follow" />
        <meta property="og:type" content="website" />
        <meta property="og:title" content="Blue Collar Books | Bookkeeping for People Who Actually Work" />
        <meta
          property="og:description"
          content="Invoicing, expenses, and cash flow for owner-operators and service trades. $20/month, 30 days free."
        />
        <meta property="og:url" content="https://www.bluecollarbookspro.com/" />
        <meta property="og:image" content="https://www.bluecollarbookspro.com/og-image.jpg" />
      </Head>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.nav}>
          <Image source={defaultLogo} style={styles.navLogo} />
          <Pressable style={styles.navSignIn} onPress={() => router.push('/login')}>
            <Text style={styles.navSignInText}>SIGN IN</Text>
          </Pressable>
        </View>

        {/* 1. HERO */}
        <View style={[styles.hero, isCompact && styles.heroCompact]}>
          <View style={[styles.heroCopy, isCompact && styles.heroCopyCompact]}>
            <Text style={styles.eyebrow}>BLUE COLLAR BOOKS</Text>
            <Text
              accessibilityRole="header"
              aria-level={1}
              style={[styles.headline, isCompact && styles.headlineCompact]}
            >
              BOOKKEEPING FOR PEOPLE WHO ACTUALLY WORK.
            </Text>
            <Text style={styles.subhead}>Keep track of your money without living in spreadsheets.</Text>
            <Text style={styles.valueLine}>Invoices. Expenses. Cash flow. Reports. One straightforward $20/month.</Text>

            <View style={styles.ctaRow}>
              <Pressable style={styles.primaryButton} onPress={goToSignup}>
                <Text style={styles.primaryButtonText}>START MY 30-DAY FREE TRIAL</Text>
              </Pressable>
              <Pressable style={styles.secondaryButton} onPress={() => router.push('/login')}>
                <Text style={styles.secondaryButtonText}>SIGN IN</Text>
              </Pressable>
            </View>
            <Text style={styles.ctaHelper}>30 days free  •  Then $20/month  •  Cancel anytime</Text>
          </View>

          <View style={[styles.previewWrap, isCompact && styles.previewWrapCompact]}>
            <View style={styles.previewPanel}>
              <View style={styles.previewHeaderRow}>
                <View style={styles.previewDot} />
                <Text style={styles.previewHeaderText}>BUSINESS DASHBOARD</Text>
              </View>
              <View style={styles.readoutGrid}>
                {readouts.map((readout) => (
                  <View key={readout.label} style={styles.readoutGridItem}>
                    <GaugeReadout {...readout} />
                  </View>
                ))}
              </View>
            </View>
          </View>
        </View>

        {/* 2. BUSINESS DASHBOARD */}
        <View style={styles.dashboardSection}>
          <Text accessibilityRole="header" aria-level={2} style={styles.sectionHeading}>
            YOUR BUSINESS. ONE DASHBOARD.
          </Text>
          <Text style={styles.sectionSubhead}>
            Know what came in, what went out, what you have, and who still owes you.
          </Text>

          <View style={styles.dashboardPanel}>
            <View style={styles.productPreviewHeader}>
              <Text style={styles.productPreviewEyebrow}>BUSINESS DASHBOARD</Text>
              <Text style={styles.productPreviewHeading}>
                Know your cash, who owes you, and what needs attention today.
              </Text>
            </View>

            <View style={styles.productMetricRow}>
              {productMetrics.map((metric) => (
                <View
                  key={metric.label}
                  style={[styles.productMetricCard, { flexBasis: isCompact ? '46%' : '22%' }]}
                >
                  <View style={styles.productMetricTopRow}>
                    <View
                      style={[
                        styles.productMetricIcon,
                        { backgroundColor: `${metric.accent}22`, borderColor: `${metric.accent}66` },
                      ]}
                    >
                      <Text style={styles.productMetricIconText}>{metric.icon}</Text>
                    </View>
                    <Text style={styles.productMetricLabel}>{metric.label}</Text>
                  </View>
                  <Text style={styles.productMetricValue}>{metric.value}</Text>
                  <Text style={styles.productMetricHelper}>{metric.helper}</Text>
                </View>
              ))}
            </View>

            <View style={[styles.productDetailRow, isCompact && styles.productDetailRowCompact]}>
              <View style={styles.productDetailCard}>
                <View style={styles.productDetailHeader}>
                  <Text style={styles.productDetailTitle}>🚨 Who Is Late</Text>
                  <Text style={styles.productDetailTotal}>Still owed: $4,120</Text>
                </View>
                <View style={styles.productDetailList}>
                  <View style={styles.productDetailListRow}>
                    <Text style={styles.productDetailListLabel}>Not late yet</Text>
                    <Text style={styles.productDetailListValue}>$2,900</Text>
                  </View>
                  <View style={styles.productDetailListRow}>
                    <Text style={styles.productDetailListLabel}>1-30 Days Past Due</Text>
                    <Text style={styles.productDetailListValue}>$960</Text>
                  </View>
                  <View style={styles.productDetailListRow}>
                    <Text style={styles.productDetailListLabel}>31-60 Days Past Due</Text>
                    <Text style={styles.productDetailListValue}>$260</Text>
                  </View>
                </View>
              </View>

              <View style={styles.productDetailCard}>
                <View style={styles.productDetailHeader}>
                  <Text style={styles.productDetailTitle}>🏦 Bank Accounts</Text>
                  <Text style={styles.productDetailTotal}>Total: $18,240</Text>
                </View>
                <View style={styles.productDetailList}>
                  <View style={styles.productDetailListRow}>
                    <View>
                      <Text style={styles.productDetailListLabel}>Business Checking</Text>
                      <Text style={styles.productDetailListSub}>Last 4: 4821</Text>
                    </View>
                    <Text style={styles.productDetailListValue}>$14,610</Text>
                  </View>
                  <View style={styles.productDetailListRow}>
                    <View>
                      <Text style={styles.productDetailListLabel}>Business Savings</Text>
                      <Text style={styles.productDetailListSub}>Last 4: 0193</Text>
                    </View>
                    <Text style={styles.productDetailListValue}>$3,630</Text>
                  </View>
                </View>
              </View>
            </View>
          </View>
        </View>

        {/* 3. FEATURES / WORKBENCH */}
        <View style={styles.workbenchSection}>
          <Text style={styles.sectionEyebrow}>THE TOOL DRAWER</Text>
          <View style={[styles.workbenchGrid, isCompact && styles.workbenchGridCompact]}>
            {workbenchItems.map((item) => (
              <View key={item.title} style={[styles.workbenchCard, isCompact && styles.workbenchCardCompact]}>
                <View style={styles.workbenchTab} />
                <Text style={styles.workbenchTitle}>{item.title}</Text>
                <Text style={styles.workbenchBody}>{item.body}</Text>
              </View>
            ))}
          </View>
        </View>

        {/* 4. PRICING */}
        <View style={styles.pricingSection}>
          <Text accessibilityRole="header" aria-level={2} style={styles.sectionHeading}>
            NO PACKAGES. NO TIERS. NO BULLSHIT.
          </Text>
          <Text style={styles.pricingAmount}>
            $20<Text style={styles.pricingPeriod}> / MONTH</Text>
          </Text>
          <Text style={styles.pricingDetail}>Everything included.{'\n'}First 30 days free.{'\n'}Cancel anytime.</Text>
          <Pressable style={styles.primaryButton} onPress={goToSignup}>
            <Text style={styles.primaryButtonText}>START MY 30-DAY FREE TRIAL</Text>
          </Pressable>
        </View>

        {/* 5. MANIFESTO */}
        <View style={styles.manifestoSection}>
          <View style={styles.manifestoAccent} />
          <Text accessibilityRole="header" aria-level={2} style={styles.manifestoHeadline}>
            YOU DIDN'T START A BUSINESS BECAUSE YOU WANTED TO BECOME A BOOKKEEPER.
          </Text>
          <Text style={styles.manifestoBody}>
            Blue Collar Books handles the boring part so you can see what's coming in, what's going out, and who
            still owes you.
          </Text>
          <Pressable style={styles.primaryButton} onPress={goToSignup}>
            <Text style={styles.primaryButtonText}>START MY 30-DAY FREE TRIAL</Text>
          </Pressable>
        </View>

        {/* 6. FOOTER */}
        <View style={[styles.footer, isCompact && styles.footerCompact]}>
          <Text style={styles.footerText}>Blue Collar Books</Text>
          <View style={styles.footerLinks}>
            <Pressable onPress={() => router.push('/login')}>
              <Text style={styles.footerLink}>Sign In</Text>
            </Pressable>
            <Pressable onPress={goToSignup}>
              <Text style={styles.footerLink}>Start Free Trial</Text>
            </Pressable>
            <Pressable onPress={() => router.push('/privacy')}>
              <Text style={styles.footerLink}>Privacy</Text>
            </Pressable>
            <Pressable onPress={() => router.push('/terms')}>
              <Text style={styles.footerLink}>Terms</Text>
            </Pressable>
          </View>
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
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  navSignInText: { color: offWhite, fontSize: 13, fontWeight: '800', letterSpacing: 0.6 },

  // --- Hero ---
  hero: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 56,
    maxWidth: 1160,
    alignSelf: 'center',
    paddingHorizontal: 32,
    paddingTop: 64,
    paddingBottom: 56,
    width: '100%',
  },
  heroCompact: {
    flexDirection: 'column',
    paddingTop: 44,
  },
  heroCopy: { flex: 1 },
  heroCopyCompact: { width: '100%' },
  eyebrow: {
    color: BrandColors.orange,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1.6,
    marginBottom: 18,
  },
  headline: {
    color: offWhite,
    fontSize: 46,
    fontWeight: '900',
    letterSpacing: 0.2,
    lineHeight: 52,
  },
  headlineCompact: {
    fontSize: 32,
    lineHeight: 38,
  },
  subhead: {
    color: BrandColors.label,
    fontSize: 18,
    fontWeight: '600',
    marginTop: 20,
    maxWidth: 480,
  },
  valueLine: {
    color: offWhite,
    fontSize: 16,
    fontWeight: '700',
    marginTop: 14,
    maxWidth: 480,
  },
  ctaRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
    marginTop: 32,
  },
  primaryButton: {
    alignItems: 'center',
    backgroundColor: BrandColors.orange,
    borderRadius: 10,
    paddingHorizontal: 26,
    paddingVertical: 16,
  },
  primaryButtonText: { color: '#111111', fontSize: 14, fontWeight: '900', letterSpacing: 0.4 },
  secondaryButton: {
    alignItems: 'center',
    borderColor: BrandColors.border,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 26,
    paddingVertical: 16,
  },
  secondaryButtonText: { color: offWhite, fontSize: 14, fontWeight: '800', letterSpacing: 0.4 },
  ctaHelper: {
    color: BrandColors.muted,
    fontSize: 13,
    fontWeight: '600',
    marginTop: 16,
  },

  // --- Instrument-panel preview (hero) ---
  previewWrap: { flex: 1, alignItems: 'stretch' },
  previewWrapCompact: { width: '100%', marginTop: 40 },
  previewPanel: {
    backgroundColor: BrandColors.card,
    borderColor: BrandColors.border,
    borderRadius: 16,
    borderWidth: 1,
    padding: 24,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.35,
    shadowRadius: 24,
  },
  previewHeaderRow: {
    alignItems: 'center',
    borderBottomColor: BrandColors.borderSubtle,
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 8,
    marginBottom: 20,
    paddingBottom: 16,
  },
  previewDot: { backgroundColor: BrandColors.orange, borderRadius: 4, height: 8, width: 8 },
  previewHeaderText: { color: BrandColors.muted, fontSize: 12, fontWeight: '800', letterSpacing: 1 },
  readoutGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
  },
  readoutGridItem: { flexBasis: '46%', flexGrow: 1 },

  // --- Instrument-style gauge tile (hero preview) ---
  gaugeTile: {
    alignItems: 'center',
    backgroundColor: BrandColors.field,
    borderColor: BrandColors.borderSubtle,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 14,
  },
  gaugeLabel: {
    color: BrandColors.muted,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 0.8,
    marginBottom: 10,
    textAlign: 'center',
  },
  gaugeArcBox: { alignSelf: 'center', position: 'relative' },
  gaugeTick: {
    borderRadius: 999,
    bottom: 0,
    left: '50%',
    position: 'absolute',
    transformOrigin: 'bottom center',
  },
  gaugeBaseline: {
    alignSelf: 'center',
    backgroundColor: BrandColors.borderSubtle,
    height: 1,
    marginTop: 2,
  },
  gaugeValue: { color: offWhite, fontSize: 20, fontWeight: '900', marginTop: 8 },
  gaugeValueCompact: { fontSize: 17 },

  // --- Business dashboard section ---
  dashboardSection: {
    borderTopColor: BrandColors.borderSubtle,
    borderTopWidth: 1,
    maxWidth: 1040,
    alignSelf: 'center',
    paddingHorizontal: 24,
    paddingTop: 56,
    width: '100%',
  },
  sectionHeading: {
    color: offWhite,
    fontSize: 26,
    fontWeight: '900',
    letterSpacing: 0.3,
    textAlign: 'center',
  },
  sectionSubhead: {
    color: BrandColors.label,
    fontSize: 16,
    fontWeight: '600',
    marginTop: 12,
    marginBottom: 32,
    textAlign: 'center',
  },
  dashboardPanel: {
    backgroundColor: BrandColors.card,
    borderColor: BrandColors.border,
    borderRadius: 16,
    borderWidth: 1,
    padding: 28,
  },

  // --- Product-accurate mini preview (mirrors src/app/dashboard.tsx) ---
  productPreviewHeader: {
    borderBottomColor: BrandColors.borderSubtle,
    borderBottomWidth: 1,
    marginBottom: 20,
    paddingBottom: 16,
  },
  productPreviewEyebrow: { color: BrandColors.orange, fontSize: 12, fontWeight: '800', letterSpacing: 1, marginBottom: 6 },
  productPreviewHeading: { color: offWhite, fontSize: 15, fontWeight: '800', maxWidth: 480 },

  productMetricRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginBottom: 20 },
  productMetricCard: {
    backgroundColor: BrandColors.field,
    borderColor: BrandColors.borderSubtle,
    borderRadius: 12,
    borderWidth: 1,
    flexGrow: 1,
    padding: 16,
  },
  productMetricTopRow: { alignItems: 'center', flexDirection: 'row', gap: 8, marginBottom: 10 },
  productMetricIcon: {
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    height: 30,
    justifyContent: 'center',
    width: 30,
  },
  productMetricIconText: { fontSize: 14, lineHeight: 16 },
  productMetricLabel: { color: BrandColors.label, fontSize: 11, fontWeight: '800', flex: 1 },
  productMetricValue: { color: offWhite, fontSize: 20, fontWeight: '900' },
  productMetricHelper: { color: BrandColors.muted, fontSize: 10, fontWeight: '700', marginTop: 4 },

  productDetailRow: { flexDirection: 'row', gap: 14 },
  productDetailRowCompact: { flexDirection: 'column' },
  productDetailCard: {
    backgroundColor: BrandColors.field,
    borderColor: BrandColors.borderSubtle,
    borderRadius: 12,
    borderWidth: 1,
    flex: 1,
    padding: 16,
  },
  productDetailHeader: {
    borderBottomColor: BrandColors.borderSubtle,
    borderBottomWidth: 1,
    marginBottom: 12,
    paddingBottom: 12,
  },
  productDetailTitle: { color: offWhite, fontSize: 13, fontWeight: '800' },
  productDetailTotal: { color: BrandColors.orange, fontSize: 11, fontWeight: '800', marginTop: 4 },
  productDetailList: { gap: 8 },
  productDetailListRow: { alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between' },
  productDetailListLabel: { color: BrandColors.label, fontSize: 12, fontWeight: '700' },
  productDetailListSub: { color: BrandColors.muted, fontSize: 10, fontWeight: '600', marginTop: 2 },
  productDetailListValue: { color: offWhite, fontSize: 13, fontWeight: '800' },

  // --- Workbench / features ---
  workbenchSection: {
    maxWidth: 1040,
    alignSelf: 'center',
    paddingHorizontal: 24,
    paddingTop: 64,
    width: '100%',
  },
  sectionEyebrow: {
    color: BrandColors.orange,
    fontSize: 13,
    fontWeight: '800',
    letterSpacing: 1.6,
    marginBottom: 24,
    textAlign: 'center',
  },
  workbenchGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  workbenchGridCompact: {
    flexDirection: 'column',
  },
  workbenchCard: {
    backgroundColor: BrandColors.card,
    borderColor: BrandColors.border,
    borderRadius: 12,
    borderWidth: 1,
    flexBasis: '31%',
    flexGrow: 1,
    padding: 22,
  },
  workbenchCardCompact: { flexBasis: '100%' },
  workbenchTab: {
    backgroundColor: BrandColors.orange,
    borderRadius: 2,
    height: 4,
    marginBottom: 16,
    width: 32,
  },
  workbenchTitle: {
    color: offWhite,
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  workbenchBody: {
    color: BrandColors.label,
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
  },

  // --- Pricing ---
  pricingSection: {
    alignItems: 'center',
    borderColor: BrandColors.orangeBorder,
    borderRadius: 16,
    borderWidth: 1,
    marginHorizontal: 24,
    marginTop: 64,
    maxWidth: 720,
    alignSelf: 'center',
    paddingHorizontal: 32,
    paddingVertical: 48,
    width: '90%',
  },
  pricingAmount: {
    color: offWhite,
    fontSize: 60,
    fontWeight: '900',
    marginTop: 24,
  },
  pricingPeriod: {
    color: BrandColors.muted,
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  pricingDetail: {
    color: BrandColors.label,
    fontSize: 15,
    fontWeight: '600',
    lineHeight: 24,
    marginTop: 16,
    marginBottom: 32,
    textAlign: 'center',
  },

  // --- Manifesto ---
  manifestoSection: {
    alignItems: 'center',
    maxWidth: 720,
    alignSelf: 'center',
    paddingHorizontal: 32,
    paddingTop: 64,
    width: '100%',
  },
  manifestoAccent: {
    backgroundColor: BrandColors.orange,
    height: 3,
    marginBottom: 28,
    width: 56,
  },
  manifestoHeadline: {
    color: offWhite,
    fontSize: 26,
    fontWeight: '900',
    lineHeight: 34,
    textAlign: 'center',
  },
  manifestoBody: {
    color: BrandColors.label,
    fontSize: 16,
    fontWeight: '600',
    lineHeight: 25,
    marginTop: 18,
    marginBottom: 32,
    maxWidth: 560,
    textAlign: 'center',
  },

  // --- Footer ---
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
  footerCompact: {
    flexDirection: 'column',
    gap: 16,
  },
  footerText: { color: BrandColors.muted, fontSize: 13, fontWeight: '700' },
  footerLinks: { flexDirection: 'row', gap: 20 },
  footerLink: { color: BrandColors.orange, fontSize: 13, fontWeight: '800' },
});
