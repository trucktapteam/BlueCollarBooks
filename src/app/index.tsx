import { router } from 'expo-router';
import { Image, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { AppShell } from '@/components/AppShell';
import { useActivities } from '@/data/activityStore';
import { startingCashBalance, useBusinessProfile } from '@/data/mockBusiness';
import { calculateTotalMonthlyExpenses, useExpenses } from '@/data/mockExpenses';
import {
  calculateInvoiceBalance,
  calculateInvoiceTotal,
  calculatePaidInvoiceTotal,
  calculateWaitingToBePaidTotal,
  formatInvoiceAmount,
  isInvoiceWaitingToBePaid,
  useInvoices,
} from '@/data/mockInvoices';

const metrics = [
  { label: 'Cash Available', value: '$7,850' },
  { label: 'Waiting To Be Paid', value: '$1,750' },
  { label: 'Money In', value: '$8,500' },
  { label: 'Money Out', value: '$4,180' },
  { label: 'Paid This Month', value: '$0' },
];

export default function HomeScreen() {
  const { width } = useWindowDimensions();
  const isCompact = width < 760;
  const isWideDesktop = width > 1400;
  const profile = useBusinessProfile();
  const expenses = useExpenses();
  const invoices = useInvoices();
  const waitingToBePaidInvoices = invoices.filter(isInvoiceWaitingToBePaid);
  const overdueInvoices = invoices.filter((invoice) => invoice.status === 'Overdue');
  const overdueInvoiceCount = overdueInvoices.length;
  const totalOverdueAmount = overdueInvoices.reduce((sum, inv) => sum + calculateInvoiceBalance(inv), 0);
  const moneyIn = calculateInvoiceTotal(invoices);
  const moneyOut = calculateTotalMonthlyExpenses(expenses);
  const profitThisMonth = moneyIn - moneyOut;
  const paidThisMonth = calculatePaidInvoiceTotal(invoices);
  const cashAvailable = startingCashBalance + paidThisMonth - moneyOut;
  const formattedTotalMonthlyExpenses = `$${moneyOut.toLocaleString()}`;
  const formattedCashAvailable = formatInvoiceAmount(cashAvailable);
  const formattedMoneyIn = formatInvoiceAmount(moneyIn);
  const formattedProfitThisMonth = formatInvoiceAmount(profitThisMonth);
  const formattedWaitingToBePaid = formatInvoiceAmount(calculateWaitingToBePaidTotal(invoices));
  const formattedPaidThisMonth = formatInvoiceAmount(paidThisMonth);
  const overdueInvoiceLabel = `${overdueInvoiceCount} overdue invoice${overdueInvoiceCount === 1 ? '' : 's'}`;
  const attentionItems = [
    overdueInvoiceLabel,
    '12 expenses need categories',
    '1 bank connection needs attention',
  ];

  return (
    <AppShell activeNav="Dashboard">
      {isWideDesktop ? (
        <View style={styles.desktopTopSection}>
          <View style={[styles.heroCard, styles.desktopHeroCard]}>
            <Text style={styles.heroLabel}>Profit This Month</Text>
            <Text style={styles.heroValue}>{formattedProfitThisMonth}</Text>
            {(profile.logoDataUrl || profile.logoModule) && (
              <Image
                source={profile.logoDataUrl ? { uri: profile.logoDataUrl } : profile.logoModule}
                style={styles.heroLogo}
              />
            )}
          </View>

          <View style={[styles.attentionSection, styles.desktopAttentionSection]}>
            <Text style={styles.attentionHeading}>Needs Attention</Text>

            <View style={styles.attentionList}>
              {attentionItems.map((item) => {
                const route = item.toLowerCase().includes('overdue')
                  ? '/invoices'
                  : item.toLowerCase().includes('expenses')
                    ? '/expenses'
                    : undefined;

                return (
                  <Pressable
                    key={item}
                    disabled={!route}
                    onPress={() => route && router.push(route)}
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
          <Text style={styles.heroLabel}>Profit This Month</Text>
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
              <Text style={styles.metricLabel}>{metric.label}</Text>
              <Text style={styles.metricValue}>
                {metric.label === 'Cash Available'
                  ? formattedCashAvailable
                  : metric.label === 'Money Out'
                    ? formattedTotalMonthlyExpenses
                    : metric.label === 'Money In'
                      ? formattedMoneyIn
                      : metric.label === 'Waiting To Be Paid'
                        ? formattedWaitingToBePaid
                        : metric.label === 'Paid This Month'
                          ? formattedPaidThisMonth
                          : metric.value}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {!isWideDesktop && (
        <View style={styles.attentionSection}>
          <Text style={styles.attentionHeading}>Needs Attention</Text>

          <View style={styles.attentionList}>
            {attentionItems.map((item) => {
              const route = item.toLowerCase().includes('overdue')
                ? '/invoices'
                : item.toLowerCase().includes('expenses')
                  ? '/expenses'
                  : undefined;

              return (
                <Pressable
                  key={item}
                  disabled={!route}
                  onPress={() => route && router.push(route)}
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
        <View style={[styles.detailCard, isCompact ? styles.fullWidthCard : isWideDesktop ? styles.quarterWidthCard : styles.halfWidthCard]}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Waiting To Be Paid</Text>
            <Text style={styles.sectionTotal}>Total: {formattedWaitingToBePaid}</Text>
          </View>

          <View style={styles.detailList}>
            {waitingToBePaidInvoices.map((item, index) => (
              <Pressable
                key={`${item.invoice}-${index}`}
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
        <View style={[styles.detailCard, isCompact ? styles.fullWidthCard : isWideDesktop ? styles.quarterWidthCard : styles.halfWidthCard]}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Overdue Invoices</Text>
            <Text style={styles.sectionTotal}>Count: {overdueInvoiceCount} • Total: ${totalOverdueAmount.toLocaleString()}</Text>
          </View>

          <View style={styles.detailList}>
            {overdueInvoices.map((item, index) => (
              <Pressable key={`${item.invoice}-${index}`} style={styles.detailRow} onPress={() => router.push('/invoices')}>
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
            <Text style={styles.sectionTitle}>Recent Expenses</Text>
          </View>

          <View style={styles.detailList}>
            {expenses.map((item, index) => (
              <Pressable
                key={`${item.date}-${item.vendor}-${index}`}
                onPress={() => router.push('/expenses')}
                style={({ pressed }) => [styles.detailRow, pressed && styles.pressed]}
              >
                <View style={styles.detailPrimary}>
                  <Text style={styles.detailTitle}>{item.vendor}</Text>
                  <Text style={styles.detailSubtitle}>{item.category}</Text>
                </View>

                <Text style={styles.detailAmount}>${item.amount}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        <View style={[styles.detailCard, isCompact ? styles.fullWidthCard : isWideDesktop ? styles.quarterWidthCard : styles.halfWidthCard]}>
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
    alignItems: 'stretch',
    flexDirection: 'row',
    gap: 24,
    marginBottom: 24,
  },
  heroCard: {
    backgroundColor: '#202020',
    borderColor: 'rgba(249, 115, 22, 0.42)',
    borderRadius: 28,
    borderWidth: 1,
    marginBottom: 24,
    padding: 40,
    shadowColor: '#f97316',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.16,
    shadowRadius: 34,
  },
  desktopHeroCard: {
    flex: 2,
    marginBottom: 0,
  },
  heroLabel: {
    color: '#a3a3a3',
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 14,
  },
  heroValue: {
    color: '#ffffff',
    fontSize: 72,
    fontWeight: '900',
    letterSpacing: 0,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 24,
  },
  metricCard: {
    backgroundColor: '#1e1e1e',
    borderColor: '#323232',
    borderRadius: 22,
    borderWidth: 1,
    justifyContent: 'space-between',
    minHeight: 170,
    padding: 28,
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
    color: '#a3a3a3',
    fontSize: 17,
    fontWeight: '600',
  },
  metricValue: {
    color: '#ffffff',
    fontSize: 40,
    fontWeight: '800',
    letterSpacing: 0,
  },
  attentionSection: {
    backgroundColor: '#1e1e1e',
    borderColor: '#323232',
    borderRadius: 22,
    borderWidth: 1,
    marginTop: 24,
    padding: 24,
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
    backgroundColor: '#252525',
    borderColor: '#353535',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  attentionDot: {
    backgroundColor: '#f97316',
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
    backgroundColor: '#1e1e1e',
    borderColor: '#323232',
    borderRadius: 22,
    borderWidth: 1,
    padding: 24,
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
    color: '#f97316',
    fontSize: 15,
    fontWeight: '800',
    marginTop: 6,
  },
  detailList: {
    gap: 12,
  },
  detailRow: {
    alignItems: 'center',
    backgroundColor: '#252525',
    borderColor: '#353535',
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
