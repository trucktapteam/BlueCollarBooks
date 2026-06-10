import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppShell } from '@/components/AppShell';
import { useInvoices } from '@/data/mockInvoices';

export default function InvoicesScreen() {
  const invoices = useInvoices();

  return (
    <AppShell activeNav="Invoices">
      <View style={styles.pageHeader}>
        <View>
          <Text style={styles.eyebrow}>Invoices</Text>
          <Text style={styles.heading}>Get paid without chasing paperwork.</Text>
        </View>

        <Pressable style={styles.newInvoiceButton} onPress={() => router.push('/new-invoice')}>
          <Text style={styles.newInvoiceText}>+ New Invoice</Text>
        </Pressable>
      </View>

      <View style={styles.invoiceCard}>
        <View style={styles.tableHeader}>
          <Text style={[styles.tableHeaderText, styles.invoiceColumn]}>Invoice #</Text>
          <Text style={[styles.tableHeaderText, styles.customerColumn]}>Customer</Text>
          <Text style={[styles.tableHeaderText, styles.amountColumn]}>Amount</Text>
          <Text style={[styles.tableHeaderText, styles.statusColumn]}>Status</Text>
          <Text style={[styles.tableHeaderText, styles.dateColumn]}>Invoice Date</Text>
        </View>

        <View style={styles.invoiceList}>
          {invoices.map((invoice, index) => (
            <View key={`${invoice.invoice}-${index}`} style={styles.invoiceRow}>
              <Text style={[styles.invoiceText, styles.invoiceColumn]}>#{invoice.invoice}</Text>
              <Text style={[styles.invoiceText, styles.customerColumn]}>{invoice.customer}</Text>
              <Text style={[styles.invoiceAmount, styles.amountColumn]}>{invoice.amount}</Text>
              <View style={styles.statusColumn}>
                <View
                  style={[
                    styles.statusPill,
                    invoice.status === 'Overdue' && styles.statusPillOverdue,
                    invoice.status === 'Draft' && styles.statusPillDraft,
                  ]}
                >
                  <Text
                    style={[
                      styles.statusText,
                      invoice.status === 'Overdue' && styles.statusTextOverdue,
                      invoice.status === 'Draft' && styles.statusTextDraft,
                    ]}
                  >
                    {invoice.status}
                  </Text>
                </View>
              </View>
              <Text style={[styles.invoiceMeta, styles.dateColumn]}>{invoice.invoiceDate}</Text>
            </View>
          ))}
        </View>
      </View>
    </AppShell>
  );
}

const styles = StyleSheet.create({
  pageHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 24,
    justifyContent: 'space-between',
    marginBottom: 28,
  },
  eyebrow: {
    color: '#f97316',
    fontSize: 15,
    fontWeight: '800',
    marginBottom: 8,
  },
  heading: {
    color: '#ffffff',
    fontSize: 34,
    fontWeight: '900',
    letterSpacing: 0,
  },
  newInvoiceButton: {
    backgroundColor: '#f97316',
    borderRadius: 16,
    paddingHorizontal: 22,
    paddingVertical: 14,
    shadowColor: '#f97316',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.2,
    shadowRadius: 24,
  },
  newInvoiceText: {
    color: '#111111',
    fontSize: 16,
    fontWeight: '900',
  },
  invoiceCard: {
    backgroundColor: '#1e1e1e',
    borderColor: '#323232',
    borderRadius: 22,
    borderWidth: 1,
    padding: 28,
  },
  tableHeader: {
    borderBottomColor: '#323232',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 16,
    paddingBottom: 14,
  },
  tableHeaderText: {
    color: '#737373',
    fontSize: 13,
    fontWeight: '900',
    textTransform: 'uppercase',
  },
  invoiceList: {
    gap: 12,
    marginTop: 16,
  },
  invoiceRow: {
    alignItems: 'center',
    backgroundColor: '#252525',
    borderColor: '#353535',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 16,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  invoiceColumn: {
    flex: 0.8,
  },
  customerColumn: {
    flex: 1.7,
  },
  amountColumn: {
    flex: 0.8,
  },
  statusColumn: {
    flex: 0.9,
  },
  dateColumn: {
    flex: 1,
  },
  invoiceText: {
    color: '#f5f5f5',
    fontSize: 15,
    fontWeight: '700',
  },
  invoiceAmount: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '900',
  },
  invoiceMeta: {
    color: '#a3a3a3',
    fontSize: 15,
    fontWeight: '600',
  },
  statusPill: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(34, 197, 94, 0.12)',
    borderColor: 'rgba(34, 197, 94, 0.36)',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  statusPillOverdue: {
    backgroundColor: 'rgba(249, 115, 22, 0.12)',
    borderColor: 'rgba(249, 115, 22, 0.42)',
  },
  statusPillDraft: {
    backgroundColor: 'rgba(163, 163, 163, 0.12)',
    borderColor: 'rgba(163, 163, 163, 0.28)',
  },
  statusText: {
    color: '#86efac',
    fontSize: 13,
    fontWeight: '900',
  },
  statusTextOverdue: {
    color: '#f97316',
  },
  statusTextDraft: {
    color: '#d4d4d4',
  },
});
