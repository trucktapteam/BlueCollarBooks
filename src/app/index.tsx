import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { AppShell } from '@/components/AppShell';
import { expenses, totalMonthlyExpenses } from '@/data/mockExpenses';
import { waitingToBePaid } from '@/data/mockInvoices';

const metrics = [
  { label: 'Cash Available', value: '$7,850' },
  { label: 'Waiting To Be Paid', value: '$1,750' },
  { label: 'Money In', value: '$8,500' },
  { label: 'Money Out', value: '$4,180' },
];

const attentionItems = [
  '3 overdue invoices',
  '12 expenses need categories',
  '1 bank connection needs attention',
];

const formattedTotalMonthlyExpenses = `$${totalMonthlyExpenses.toLocaleString()}`;

export default function HomeScreen() {
  const { width } = useWindowDimensions();
  const isCompact = width < 760;

  return (
    <AppShell activeNav="Dashboard">
      <View style={styles.heroCard}>
        <Text style={styles.heroLabel}>Profit This Month</Text>
        <Text style={styles.heroValue}>$4,320</Text>
      </View>

      <View style={styles.grid}>
        {metrics.map((metric) => (
          <View
            key={metric.label}
            style={[styles.metricCard, isCompact ? styles.fullWidthCard : styles.halfWidthCard]}
          >
            <Text style={styles.metricLabel}>{metric.label}</Text>
            <Text style={styles.metricValue}>
              {metric.label === 'Money Out' ? formattedTotalMonthlyExpenses : metric.value}
            </Text>
          </View>
        ))}
      </View>

      <View style={styles.attentionSection}>
        <Text style={styles.attentionHeading}>Needs Attention</Text>

        <View style={styles.attentionList}>
          {attentionItems.map((item) => (
            <View key={item} style={styles.attentionRow}>
              <View style={styles.attentionDot} />
              <Text style={styles.attentionText}>{item}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.detailGrid}>
        <View style={[styles.detailCard, isCompact ? styles.fullWidthCard : styles.halfWidthCard]}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Waiting To Be Paid</Text>
            <Text style={styles.sectionTotal}>Total: $1,750</Text>
          </View>

          <View style={styles.detailList}>
            {waitingToBePaid.map((item) => (
              <View key={item.invoice} style={styles.detailRow}>
                <View style={styles.detailPrimary}>
                  <Text style={styles.detailTitle}>
                    {item.invoice} {item.customer}
                  </Text>
                  <Text style={styles.detailSubtitle}>{item.status}</Text>
                </View>

                <Text style={styles.detailAmount}>{item.amount}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={[styles.detailCard, isCompact ? styles.fullWidthCard : styles.halfWidthCard]}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Recent Expenses</Text>
          </View>

          <View style={styles.detailList}>
            {expenses.map((item) => (
              <View key={item.vendor} style={styles.detailRow}>
                <View style={styles.detailPrimary}>
                  <Text style={styles.detailTitle}>{item.vendor}</Text>
                  <Text style={styles.detailSubtitle}>{item.category}</Text>
                </View>

                <Text style={styles.detailAmount}>${item.amount}</Text>
              </View>
            ))}
          </View>
        </View>
      </View>
    </AppShell>
  );
}

const styles = StyleSheet.create({
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
});
