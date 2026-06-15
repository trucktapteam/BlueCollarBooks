import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { AppShell } from '@/components/AppShell';
import { formatInvoiceAmount, type InvoicePayment, useInvoices } from '@/data/mockInvoices';

function isSameMonth(dateString: string, comparisonDate: Date) {
  const parsed = Date.parse(dateString);
  if (!Number.isFinite(parsed)) return false;
  const date = new Date(parsed);
  return date.getFullYear() === comparisonDate.getFullYear() && date.getMonth() === comparisonDate.getMonth();
}

type PaymentRow = InvoicePayment & {
  invoiceNumber: string;
  customer: string;
};

function formatPaymentDate(date: string) {
  const parsed = Date.parse(date);
  if (!Number.isFinite(parsed)) return date;
  return new Date(parsed).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function PaymentsScreen() {
  const [query, setQuery] = useState('');
  const invoices = useInvoices();

  const payments = useMemo<PaymentRow[]>(() => {
    return invoices.flatMap((invoice) =>
      (invoice.payments ?? []).map((payment) => ({
        ...payment,
        invoiceNumber: invoice.invoice,
        customer: invoice.customer,
      }))
    );
  }, [invoices]);

  const sortedPayments = useMemo(() => {
    return [...payments].sort((left, right) => {
      const leftTime = Date.parse(left.date);
      const rightTime = Date.parse(right.date);
      if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) {
        return rightTime - leftTime;
      }
      if (Number.isFinite(leftTime)) return -1;
      if (Number.isFinite(rightTime)) return 1;
      return 0;
    });
  }, [payments]);

  const visiblePayments = useMemo(() => {
    if (!query.trim()) return sortedPayments;

    const q = query.toLowerCase();
    return sortedPayments.filter((payment) =>
      payment.customer.toLowerCase().includes(q) ||
      payment.invoiceNumber.toLowerCase().includes(q)
    );
  }, [query, sortedPayments]);

  const paymentsThisMonth = useMemo(() => {
    const now = new Date();
    return payments.filter((payment) => isSameMonth(payment.date, now)).length;
  }, [payments]);

  const totalPaymentsReceived = useMemo(() => {
    return payments.reduce((sum, payment) => sum + payment.amount, 0);
  }, [payments]);

  return (
    <AppShell activeNav="Payments">
      <View style={styles.pageHeader}>
        <View>
          <Text style={styles.eyebrow}>Payments</Text>
          <Text style={styles.heading}>Keep all invoice payments visible in one place.</Text>
        </View>
      </View>

      <View style={styles.summaryCard}>
        <View style={styles.summaryRow}>
          <View>
            <Text style={styles.summaryLabel}>Payments This Month</Text>
            <Text style={styles.summaryValue}>{paymentsThisMonth}</Text>
          </View>

          <View>
            <Text style={styles.summaryLabel}>Total Payments Received</Text>
            <Text style={styles.summaryValue}>{formatInvoiceAmount(totalPaymentsReceived)}</Text>
          </View>
        </View>
      </View>

      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search payments (customer, invoice number)"
          placeholderTextColor="#6b6b6b"
          value={query}
          onChangeText={setQuery}
        />
      </View>

      <View style={styles.paymentCard}>
        <View style={styles.tableHeader}>
          <Text style={[styles.tableHeaderText, styles.dateColumn]}>Date Received</Text>
          <Text style={[styles.tableHeaderText, styles.customerColumn]}>Customer</Text>
          <Text style={[styles.tableHeaderText, styles.invoiceColumn]}>Invoice Number</Text>
          <Text style={[styles.tableHeaderText, styles.amountColumn]}>Amount</Text>
          <Text style={[styles.tableHeaderText, styles.notesColumn]}>Notes</Text>
        </View>

        <View style={styles.paymentList}>
          {visiblePayments.length > 0 ? (
            visiblePayments.map((payment) => (
              <Pressable
                key={payment.id}
                style={styles.paymentRow}
                onPress={() => router.push(`/new-invoice?invoice=${encodeURIComponent(payment.invoiceNumber)}`)}
              >
                <Text style={[styles.paymentMeta, styles.dateColumn]}>{formatPaymentDate(payment.date)}</Text>
                <Text style={[styles.paymentText, styles.customerColumn]}>{payment.customer}</Text>
                <Text style={[styles.paymentText, styles.invoiceColumn]}>#{payment.invoiceNumber}</Text>
                <Text style={[styles.paymentAmount, styles.amountColumn]}>{formatInvoiceAmount(payment.amount)}</Text>
                <Text style={[styles.paymentMeta, styles.notesColumn]} numberOfLines={1}>{payment.notes ?? '-'}</Text>
              </Pressable>
            ))
          ) : (
            <View style={styles.emptyRow}>
              <Text style={styles.emptyText}>No payments recorded yet.</Text>
            </View>
          )}
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
  summaryCard: {
    backgroundColor: '#202020',
    borderColor: 'rgba(249, 115, 22, 0.42)',
    borderRadius: 22,
    borderWidth: 1,
    marginBottom: 24,
    padding: 28,
    shadowColor: '#f97316',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.12,
    shadowRadius: 26,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: 24,
  },
  summaryLabel: {
    color: '#a3a3a3',
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 8,
  },
  summaryValue: {
    color: '#ffffff',
    fontSize: 46,
    fontWeight: '900',
  },
  searchRow: { marginTop: 18, marginBottom: 12, gap: 12 },
  searchInput: {
    backgroundColor: '#252525',
    borderColor: '#353535',
    borderRadius: 10,
    borderWidth: 1,
    color: '#ffffff',
    padding: 10,
  },
  paymentCard: {
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
  paymentList: {
    gap: 12,
    marginTop: 16,
  },
  paymentRow: {
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
  dateColumn: {
    flex: 1,
  },
  customerColumn: {
    flex: 1.5,
  },
  invoiceColumn: {
    flex: 1.1,
  },
  amountColumn: {
    flex: 0.9,
  },
  notesColumn: {
    flex: 1.8,
  },
  paymentText: {
    color: '#f5f5f5',
    fontSize: 15,
    fontWeight: '800',
  },
  paymentMeta: {
    color: '#a3a3a3',
    fontSize: 15,
    fontWeight: '600',
  },
  paymentAmount: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '900',
  },
  emptyRow: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 130,
  },
  emptyText: {
    color: '#a3a3a3',
    fontSize: 15,
    fontWeight: '700',
  },
});
