import { router } from 'expo-router';
import Head from 'expo-router/head';
import { useState } from 'react';
import { Image, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';

import { AppShell } from '@/components/AppShell';
import { BrandColors } from '@/constants/theme';
import { useActivities } from '@/data/activityStore';
import { sumBankAccountBalances, useBankAccounts } from '@/data/mockBankAccounts';
import { useBusinessProfile } from '@/data/mockBusiness';
import { calculateTotalMonthlyExpenses, useExpenses } from '@/data/mockExpenses';
import {
  calculateInvoiceBalance,
  calculateInvoiceTotal,
  calculatePaidInvoiceTotal,
  calculateWaitingToBePaidTotal,
  formatInvoiceAmount,
  isInvoiceWaitingToBePaid,
  isSameMonth,
  useInvoices,
} from '@/data/mockInvoices';
import { computeDueDate } from '@/utils/date';

// Every label below is matched explicitly to a live computed value further
// down (metricValues), so this array intentionally carries no dollar amount
// of its own - there used to be a hardcoded `value` field here (e.g.
// '$7,850') that every render path bypassed in favor of a real number, so it
// was dead weight that could mislead a future editor into thinking it was
// live.
const metrics = [
  { label: 'Cash Available', icon: '💵', accent: BrandColors.green, helper: 'All accounts' },
  { label: 'Waiting To Be Paid', icon: '💰', accent: BrandColors.orange, helper: 'Open invoices' },
  { label: 'Money In', icon: '📈', accent: BrandColors.green, helper: 'This month' },
  { label: 'Money Out', icon: '🧾', accent: BrandColors.orange, helper: 'This month' },
  { label: 'Paid This Month', icon: '✔', accent: BrandColors.green, helper: 'Collected cash' },
];

export default function DashboardScreen() {
  const { width } = useWindowDimensions();
  const isCompact = width < 760;
  const isWideDesktop = width > 1400;
  const [dashboardQuery, setDashboardQuery] = useState('');
  const profile = useBusinessProfile();
  const bankAccounts = useBankAccounts();
  const expenses = useExpenses();
  const invoices = useInvoices();
  const waitingToBePaidInvoices = invoices.filter(isInvoiceWaitingToBePaid);
  const overdueInvoices = invoices.filter((invoice) => invoice.status === 'Overdue');
  const overdueInvoiceCount = overdueInvoices.length;
  const missingPaperworkCount = invoices.filter((invoice) => (invoice.attachments ?? []).length === 0).length;
  const totalOverdueAmount = overdueInvoices.reduce((sum, inv) => sum + calculateInvoiceBalance(inv), 0);
  const now = new Date();
  const invoicesThisMonth = invoices.filter((invoice) => isSameMonth(invoice.invoiceDate, now));
  const moneyIn = calculateInvoiceTotal(invoicesThisMonth);
  const moneyOut = calculateTotalMonthlyExpenses(expenses, now);
  const profitThisMonth = moneyIn - moneyOut;
  const paidThisMonth = calculatePaidInvoiceTotal(invoices);
  // Bank account balances are the real starting point, not a hardcoded
  // number - see sumBankAccountBalances in mockBankAccounts.ts. The old
  // constant here happened to equal only Business Checking, so Business
  // Savings never counted toward Cash Available.
  const cashAvailable = sumBankAccountBalances(bankAccounts) + paidThisMonth - moneyOut;
  const formattedTotalMonthlyExpenses = formatInvoiceAmount(moneyOut);
  const formattedCashAvailable = formatInvoiceAmount(cashAvailable);
  const formattedMoneyIn = formatInvoiceAmount(moneyIn);
  const formattedProfitThisMonth = formatInvoiceAmount(profitThisMonth);
  const formattedWaitingToBePaid = formatInvoiceAmount(calculateWaitingToBePaidTotal(invoices));
  const formattedPaidThisMonth = formatInvoiceAmount(paidThisMonth);
  const metricValues: Record<string, string> = {
    'Cash Available': formattedCashAvailable,
    'Money Out': formattedTotalMonthlyExpenses,
    'Money In': formattedMoneyIn,
    'Waiting To Be Paid': formattedWaitingToBePaid,
    'Paid This Month': formattedPaidThisMonth,
  };

  const agingBuckets = (() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const buckets = {
      current: 0,
      oneToThirty: 0,
      thirtyOneToSixty: 0,
      sixtyOneToNinety: 0,
      overNinety: 0,
    };

    invoices.forEach((invoice) => {
      const balance = calculateInvoiceBalance(invoice);
      if (balance <= 0) return;
      const rawDueDate = computeDueDate(invoice.invoiceDate, invoice.terms);
      const dueDate = rawDueDate && new Date(rawDueDate.getFullYear(), rawDueDate.getMonth(), rawDueDate.getDate());
      if (!dueDate) {
        buckets.current += balance;
        return;
      }

      const diff = Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));
      if (diff <= 0) {
        buckets.current += balance;
      } else if (diff <= 30) {
        buckets.oneToThirty += balance;
      } else if (diff <= 60) {
        buckets.thirtyOneToSixty += balance;
      } else if (diff <= 90) {
        buckets.sixtyOneToNinety += balance;
      } else {
        buckets.overNinety += balance;
      }
    });

    return buckets;
  })();

  const totalOutstanding =
    agingBuckets.current +
    agingBuckets.oneToThirty +
    agingBuckets.thirtyOneToSixty +
    agingBuckets.sixtyOneToNinety +
    agingBuckets.overNinety;

  const invoicesOverThirtyPastDue = invoices.filter((invoice) => {
    const balance = calculateInvoiceBalance(invoice);
    if (balance <= 0) return false;
    const dueDate = computeDueDate(invoice.invoiceDate, invoice.terms);
    if (!dueDate) return false;
    const today = new Date();
    const diff = Math.floor((new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() - new Date(dueDate.getFullYear(), dueDate.getMonth(), dueDate.getDate()).getTime()) / (1000 * 60 * 60 * 24));
    return diff > 30;
  }).length;

  const overdueInvoiceLabel = `${overdueInvoiceCount} overdue invoice${overdueInvoiceCount === 1 ? '' : 's'}`;
  // Only real, computed alerts belong here. This list used to also include
  // two hardcoded placeholder strings ("12 expenses need categories", "1
  // bank connection needs attention") with no actual check behind them -
  // nothing in the app tracks expense categories or bank connection health,
  // so those two items always showed no matter what was really going on.
  const attentionItems = [
    overdueInvoiceLabel,
    `Invoices over 30 days past due: ${invoicesOverThirtyPastDue}`,
    ...(missingPaperworkCount > 0 ? ['Invoices missing paperwork'] : []),
  ];
  const handleAttentionPress = (item: string) => {
    const lowerItem = item.toLowerCase();
    if (lowerItem.includes('overdue') || lowerItem.includes('paperwork') || lowerItem.includes('past due')) {
      router.push('/invoices');
    }
  };

  return (
    <AppShell activeNav="Dashboard">
      <Head>
        <title>Dashboard | Blue Collar Books</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <View style={styles.dashboardHeader}>
        <View>
          <Text style={styles.dashboardEyebrow}>Shop Dashboard</Text>
          <Text style={styles.dashboardHeading}>Know your cash, who owes you, and what needs attention today.</Text>
        </View>
        <TextInput
          style={styles.dashboardSearchInput}
          placeholder="Search invoices, customers, expenses..."
          placeholderTextColor="#6b6b6b"
          value={dashboardQuery}
          onChangeText={setDashboardQuery}
        />
      </View>
      {isWideDesktop ? (
        <View style={styles.desktopTopSection}>
          <View style={[styles.heroCard, styles.desktopHeroCard, styles.heroCardDesktopCompact]}>
            <Text style={styles.heroLabel}>📈 Profit This Month</Text>
            <Text style={styles.heroValue}>{formattedProfitThisMonth}</Text>
            {(profile.logoDataUrl || profile.logoModule) && (
              <Image
                source={profile.logoDataUrl ? { uri: profile.logoDataUrl } : profile.logoModule}
                style={styles.heroLogo}
              />
            )}
          </View>

          <View style={[styles.attentionSection, styles.desktopAttentionSection]}>
            <Text style={styles.attentionHeading}>⚠ Needs Attention</Text>

            <View style={styles.attentionList}>
              {attentionItems.map((item) => {
                const isActionable = item.toLowerCase().includes('overdue') || item.toLowerCase().includes('paperwork') || item.toLowerCase().includes('past due');

                return (
                  <Pressable
                    key={item}
                    disabled={!isActionable}
                    onPress={() => handleAttentionPress(item)}
                    style={({ pressed }) => [styles.attentionRow, pressed && styles.pressed]}
                  >
                    <View style={styles.attentionDot} />
                    <Text style={styles.attentionText}>{item}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        </View>
      ) : (
        <View style={styles.heroCard}>
          <Text style={styles.heroLabel}>📈 Profit This Month</Text>
          <Text style={styles.heroValue}>{formattedProfitThisMonth}</Text>
          {(profile.logoDataUrl || profile.logoModule) && (
            <Image
              source={profile.logoDataUrl ? { uri: profile.logoDataUrl } : profile.logoModule}
              style={styles.heroLogo}
            />
          )}
        </View>
      )}

      <View style={styles.grid}>
        {metrics.map((metric) => {
          const route =
            metric.label === 'Money In' || metric.label === 'Waiting To Be Paid' || metric.label === 'Paid This Month'
              ? '/invoices'
              : metric.label === 'Money Out'
                ? '/expenses'
                : metric.label === 'Cash Available'
                  ? undefined
                  : undefined;

          return (
            <Pressable
              key={metric.label}
              disabled={!route}
              onPress={() => route && router.push(route)}
              style={({ pressed }) => [
                styles.metricCard,
                isCompact ? styles.fullWidthCard : isWideDesktop ? styles.fifthWidthCard : styles.halfWidthCard,
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.metricTopRow}>
                <View style={[styles.metricIcon, { backgroundColor: `${metric.accent}22`, borderColor: `${metric.accent}66` }]}>
                  <Text style={styles.metricIconText}>{metric.icon}</Text>
                </View>
                <Text style={styles.metricLabel}>{metric.label}</Text>
              </View>
              <Text style={styles.metricValue}>{metricValues[metric.label]}</Text>
              <Text style={styles.metricHelper}>{metric.helper}</Text>
            </Pressable>
          );
        })}
      </View>

      {!isWideDesktop && (
        <View style={styles.attentionSection}>
          <Text style={styles.attentionHeading}>⚠ Needs Attention</Text>

          <View style={styles.attentionList}>
            {attentionItems.map((item) => {
              const isActionable = item.toLowerCase().includes('overdue') || item.toLowerCase().includes('paperwork') || item.toLowerCase().includes('past due') || item.toLowerCase().includes('expenses') || item.toLowerCase().includes('bank');

              return (
                <Pressable
                  key={item}
                  disabled={!isActionable}
                  onPress={() => handleAttentionPress(item)}
                  style={({ pressed }) => [styles.attentionRow, pressed && styles.pressed]}
                >
                  <View style={styles.attentionDot} />
                  <Text style={styles.attentionText}>{item}</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      )}

      <View style={styles.detailGrid}>
        <View
          style={[
            styles.detailCard,
            isCompact ? styles.fullWidthCard : isWideDesktop ? styles.quarterWidthCard : styles.halfWidthCard,
          ]}
        >
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>🏦 Bank Accounts</Text>
            <Text style={styles.sectionTotal}>Total: {formatInvoiceAmount(sumBankAccountBalances(bankAccounts))}</Text>
          </View>

          <View style={styles.detailList}>
            {bankAccounts.map((account) => (
              <View key={account.id} style={styles.detailRow}>
                <View style={styles.detailPrimary}>
                  <Text style={styles.detailTitle}>{account.name}</Text>
                  <Text style={styles.detailSubtitle}>Last 4: {account.last4}</Text>
                  <Text style={styles.detailSubtitle}>Updated {account.lastUpdated}</Text>
                </View>

                <Text style={styles.detailAmount}>{formatInvoiceAmount(account.balance)}</Text>
              </View>
            ))}
          </View>

          <Pressable style={styles.connectBankButton}>
            <Text style={styles.connectBankButtonText}>Connect Bank</Text>
          </Pressable>
        </View>

        <View style={[styles.detailCard, isCompact ? styles.fullWidthCard : isWideDesktop ? styles.quarterWidthCard : styles.halfWidthCard]}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>💰 Waiting To Be Paid</Text>
            <Text style={styles.sectionTotal}>Total: {formattedWaitingToBePaid}</Text>
          </View>

          <View style={styles.detailList}>
            {waitingToBePaidInvoices.map((item) => (
              <Pressable
                key={item.id}
                onPress={() => router.push('/invoices')}
                style={({ pressed }) => [styles.detailRow, pressed && styles.pressed]}
              >
                <View style={styles.detailPrimary}>
                  <Text style={styles.detailTitle}>
                    #{item.invoice} {item.customer}
                  </Text>
                  <Text style={styles.detailSubtitle}>{item.status}</Text>
                </View>

                <Text style={styles.detailAmount}>{formatInvoiceAmount(calculateInvoiceBalance(item))}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        <Pressable
          style={[styles.detailCard, isCompact ? styles.fullWidthCard : isWideDesktop ? styles.quarterWidthCard : styles.halfWidthCard]}
          onPress={() => router.push('/invoices')}
        >
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>🚨 Who Is Late</Text>
            <Text style={styles.sectionTotal}>Still owed: {formatInvoiceAmount(totalOutstanding)}</Text>
          </View>

          <View style={styles.detailList}>
            <View style={styles.detailRow}>
              <View style={styles.detailPrimary}>
                <Text style={styles.detailTitle}>Not late yet</Text>
              </View>
              <Text style={styles.detailAmount}>{formatInvoiceAmount(agingBuckets.current)}</Text>
            </View>
            <View style={styles.detailRow}>
              <View style={styles.detailPrimary}>
                <Text style={styles.detailTitle}>1-30 Days Past Due</Text>
              </View>
              <Text style={styles.detailAmount}>{formatInvoiceAmount(agingBuckets.oneToThirty)}</Text>
            </View>
            <View style={styles.detailRow}>
              <View style={styles.detailPrimary}>
                <Text style={styles.detailTitle}>31-60 Days Past Due</Text>
              </View>
              <Text style={styles.detailAmount}>{formatInvoiceAmount(agingBuckets.thirtyOneToSixty)}</Text>
            </View>
            <View style={styles.detailRow}>
              <View style={styles.detailPrimary}>
                <Text style={styles.detailTitle}>61-90 Days Past Due</Text>
              </View>
              <Text style={styles.detailAmount}>{formatInvoiceAmount(agingBuckets.sixtyOneToNinety)}</Text>
            </View>
            <View style={styles.detailRow}>
              <View style={styles.detailPrimary}>
                <Text style={styles.detailTitle}>90+ Days Past Due</Text>
              </View>
              <Text style={styles.detailAmount}>{formatInvoiceAmount(agingBuckets.overNinety)}</Text>
            </View>
          </View>
        </Pressable>
        <View style={[styles.detailCard, isCompact ? styles.fullWidthCard : isWideDesktop ? styles.quarterWidthCard : styles.halfWidthCard]}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>❌ Late Payments</Text>
            <Text style={styles.sectionTotal}>Count: {overdueInvoiceCount} • Total: {formatInvoiceAmount(totalOverdueAmount)}</Text>
          </View>

          <View style={styles.detailList}>
            {overdueInvoices.map((item) => (
              <Pressable key={item.id} style={styles.detailRow} onPress={() => router.push('/invoices')}>
                <View style={styles.detailPrimary}>
                  <Text style={styles.detailTitle}>#{item.invoice} {item.customer}</Text>
                  <Text style={styles.detailSubtitle}>{item.status}</Text>
                </View>

                <Text style={styles.detailAmount}>{formatInvoiceAmount(calculateInvoiceBalance(item))}</Text>
              </Pressable>
            ))}
          </View>
        </View>
        <View style={[styles.detailCard, isCompact ? styles.fullWidthCard : isWideDesktop ? styles.quarterWidthCard : styles.halfWidthCard]}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>🧾 Recent Expenses</Text>
          </View>

          <View style={styles.detailList}>
            {expenses.map((item) => (
              <Pressable
                key={item.id}
                onPress={() => router.push('/expenses')}
                style={({ pressed }) => [styles.detailRow, pressed && styles.pressed]}
              >
                <View style={styles.detailPrimary}>
                  <Text style={styles.detailTitle}>{item.vendor}</Text>
                  <Text style={styles.detailSubtitle}>{item.category}</Text>
                </View>

                <Text style={styles.detailAmount}>{formatInvoiceAmount(item.amount)}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View
          style={[
            styles.detailCard,
            styles.recentActivityCard,
            isCompact ? styles.fullWidthCard : isWideDesktop ? styles.quarterWidthCard : styles.halfWidthCard,
          ]}
        >
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Recent Activity</Text>
          </View>

          <RecentActivity />
        </View>
      </View>
    </AppShell>
  );
}

function relativeTime(iso: string) {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diff = Math.floor((now - then) / 1000);

  if (diff < 5) return 'just now';
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(iso).toLocaleString();
}

function RecentActivity() {
  const activities = useActivities();
  const recent = activities.slice(0, 10);

  return (
    <View style={styles.detailList}>
      {recent.map((act) => (
        <View key={act.id} style={styles.detailRow}>
          <View style={styles.detailPrimary}>
            <Text style={styles.detailTitle}>{act.message}</Text>
            <Text style={styles.detailSubtitle}>{relativeTime(act.timestamp)}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  desktopTopSection: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 24,
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  heroCard: {
    backgroundColor: BrandColors.cardRaised,
    borderColor: BrandColors.orangeBorder,
    borderRadius: 28,
    borderWidth: 1,
    marginBottom: 24,
    minHeight: 220,
    padding: 28,
    shadowColor: BrandColors.orange,
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.16,
    shadowRadius: 34,
    position: 'relative',
  },
  desktopHeroCard: {
    flex: 2,
    marginBottom: 0,
  },
  heroCardDesktopCompact: {
    minHeight: 170,
    paddingVertical: 24,
  },
  heroLabel: {
    color: BrandColors.label,
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 14,
  },
  heroValue: {
    color: '#ffffff',
    fontSize: 56,
    fontWeight: '900',
    letterSpacing: 0,
    lineHeight: 64,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 24,
  },
  metricCard: {
    backgroundColor: BrandColors.card,
    borderColor: BrandColors.border,
    borderRadius: 24,
    borderWidth: 1,
    justifyContent: 'space-between',
    minHeight: 190,
    padding: 28,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.22,
    shadowRadius: 22,
  },
  halfWidthCard: {
    flexBasis: '48%',
    flexGrow: 1,
  },
  quarterWidthCard: {
    flexBasis: '23%',
    flexGrow: 1,
  },
  fifthWidthCard: {
    flexBasis: '18%',
    flexGrow: 1,
  },
  fullWidthCard: {
    flexBasis: '100%',
  },
  metricLabel: {
    color: BrandColors.label,
    fontSize: 17,
    fontWeight: '800',
    flex: 1,
  },
  metricTopRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  metricIcon: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    height: 46,
    justifyContent: 'center',
    width: 46,
  },
  metricIconText: {
    fontSize: 24,
    lineHeight: 28,
  },
  metricValue: {
    color: BrandColors.white,
    fontSize: 44,
    fontWeight: '900',
    letterSpacing: 0,
  },
  metricHelper: {
    color: BrandColors.muted,
    fontSize: 14,
    fontWeight: '800',
  },
  attentionSection: {
    backgroundColor: BrandColors.card,
    borderColor: BrandColors.orangeBorder,
    borderRadius: 24,
    borderWidth: 1,
    marginTop: 24,
    padding: 24,
  },
  dashboardHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 20,
    justifyContent: 'space-between',
    marginBottom: 24,
    width: '100%',
  },
  dashboardEyebrow: {
    color: BrandColors.orange,
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 8,
  },
  dashboardHeading: {
    color: '#ffffff',
    fontSize: 24,
    fontWeight: '900',
    maxWidth: 620,
  },
  dashboardSearchInput: {
    backgroundColor: BrandColors.field,
    borderColor: BrandColors.border,
    borderRadius: 12,
    borderWidth: 1,
    color: '#ffffff',
    flex: 1,
    minWidth: 260,
    padding: 12,
  },
  desktopAttentionSection: {
    flex: 1,
    marginTop: 0,
  },
  attentionHeading: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 16,
  },
  attentionList: {
    gap: 12,
  },
  attentionRow: {
    alignItems: 'center',
    backgroundColor: BrandColors.field,
    borderColor: BrandColors.border,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  attentionDot: {
    backgroundColor: BrandColors.orange,
    borderRadius: 5,
    height: 10,
    width: 10,
  },
  attentionText: {
    color: '#d4d4d4',
    fontSize: 16,
    fontWeight: '600',
  },
  detailGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 24,
    marginTop: 24,
  },
  detailCard: {
    backgroundColor: BrandColors.card,
    borderColor: BrandColors.border,
    borderRadius: 24,
    borderWidth: 1,
    padding: 24,
  },
  highlightedDetailCard: {
    borderColor: 'rgba(255, 122, 0, 0.72)',
  },
  recentActivityCard: {
    alignSelf: 'flex-start',
  },
  sectionHeader: {
    borderBottomColor: '#323232',
    borderBottomWidth: 1,
    marginBottom: 16,
    paddingBottom: 16,
  },
  sectionTitle: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '800',
  },
  sectionTotal: {
    color: BrandColors.orange,
    fontSize: 15,
    fontWeight: '800',
    marginTop: 6,
  },
  connectBankButton: {
    alignItems: 'center',
    backgroundColor: BrandColors.orangeSoft,
    borderColor: BrandColors.orangeBorder,
    borderRadius: 12,
    borderWidth: 1,
    marginTop: 16,
    paddingHorizontal: 12,
    paddingVertical: 12,
    width: '100%',
  },
  connectBankButtonText: {
    color: BrandColors.orange,
    fontSize: 13,
    fontWeight: '900',
  },
  detailList: {
    gap: 12,
  },
  detailRow: {
    alignItems: 'center',
    backgroundColor: BrandColors.field,
    borderColor: BrandColors.border,
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 16,
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  detailPrimary: {
    flex: 1,
    gap: 4,
  },
  detailTitle: {
    color: '#f5f5f5',
    fontSize: 16,
    fontWeight: '700',
  },
  detailSubtitle: {
    color: '#a3a3a3',
    fontSize: 14,
    fontWeight: '600',
  },
  detailAmount: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '800',
  },
  pressed: {
    backgroundColor: '#232323',
    transform: [{ scale: 0.997 }],
    opacity: 0.96,
  },
  heroLogo: {
    position: 'absolute',
    top: 16,
    right: 16,
    width: 64,
    height: 64,
    borderRadius: 8,
    overflow: 'hidden',
  },
});
