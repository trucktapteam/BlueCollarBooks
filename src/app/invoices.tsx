import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppShell } from '@/components/AppShell';
import { type InvoiceStatus, updateInvoiceStatus, useInvoices } from '@/data/mockInvoices';

function getStatusPillStyle(status: InvoiceStatus) {
  return [
    styles.statusPill,
    status === 'Draft' && styles.statusPillDraft,
    status === 'Sent' && styles.statusPillSent,
    status === 'Paid' && styles.statusPillPaid,
    status === 'Overdue' && styles.statusPillOverdue,
  ];
}

function getStatusTextStyle(status: InvoiceStatus) {
  return [
    styles.statusText,
    status === 'Draft' && styles.statusTextDraft,
    status === 'Sent' && styles.statusTextSent,
    status === 'Paid' && styles.statusTextPaid,
    status === 'Overdue' && styles.statusTextOverdue,
  ];
}

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
          <Text style={[styles.tableHeaderText, styles.actionColumn]}>Action</Text>
        </View>

        <View style={styles.invoiceList}>
          {invoices.map((invoice, index) => (
            <View key={`${invoice.invoice}-${index}`} style={styles.invoiceRow}>
              <Text style={[styles.invoiceText, styles.invoiceColumn]}>#{invoice.invoice}</Text>
              <Text style={[styles.invoiceText, styles.customerColumn]}>{invoice.customer}</Text>
              <Text style={[styles.invoiceAmount, styles.amountColumn]}>{invoice.amount}</Text>
              <View style={styles.statusColumn}>
                <View style={getStatusPillStyle(invoice.status)}>
                  <Text style={getStatusTextStyle(invoice.status)}>{invoice.status}</Text>
                </View>
              </View>
              <Text style={[styles.invoiceMeta, styles.dateColumn]}>{invoice.invoiceDate}</Text>
              <View style={styles.actionColumn}>
                <Pressable style={styles.editButton} onPress={() => router.push(`/new-invoice?invoice=${encodeURIComponent(invoice.invoice)}`)}>
                  <Text style={styles.editButtonText}>Edit</Text>
                </Pressable>
                {invoice.status !== 'Paid' && (
                  <Pressable style={styles.markPaidButton} onPress={() => updateInvoiceStatus(invoice.invoice, 'Paid')}>
                    <Text style={styles.markPaidButtonText}>Mark Paid</Text>
                  </Pressable>
                )}
                {invoice.status === 'Paid' && <Text style={styles.paidActionText}>Paid</Text>}
              </View>
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
  actionColumn: {
    flex: 0.9,
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
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  statusPillDraft: {
    backgroundColor: 'rgba(163, 163, 163, 0.12)',
    borderColor: 'rgba(163, 163, 163, 0.28)',
  },
  statusPillSent: {
    backgroundColor: 'rgba(59, 130, 246, 0.12)',
    borderColor: 'rgba(59, 130, 246, 0.42)',
  },
  statusPillPaid: {
    backgroundColor: 'rgba(34, 197, 94, 0.12)',
    borderColor: 'rgba(34, 197, 94, 0.36)',
  },
  statusPillOverdue: {
    backgroundColor: 'rgba(239, 68, 68, 0.12)',
    borderColor: 'rgba(239, 68, 68, 0.42)',
  },
  statusText: {
    fontSize: 13,
    fontWeight: '900',
  },
  statusTextDraft: {
    color: '#d4d4d4',
  },
  statusTextSent: {
    color: '#93c5fd',
  },
  statusTextPaid: {
    color: '#86efac',
  },
  statusTextOverdue: {
    color: '#fca5a5',
  },
  markPaidButton: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(34, 197, 94, 0.12)',
    borderColor: 'rgba(34, 197, 94, 0.36)',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  markPaidButtonText: {
    color: '#86efac',
    fontSize: 13,
    fontWeight: '900',
  },
  paidActionText: {
    color: '#737373',
    fontSize: 13,
    fontWeight: '800',
  },
  editButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#252525',
    borderColor: '#343434',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 8,
  },
  editButtonText: {
    color: '#d4d4d4',
    fontSize: 13,
    fontWeight: '900',
  },
});
