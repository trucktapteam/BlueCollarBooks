import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { AppShell } from '@/components/AppShell';
import { ReceivePaymentModal } from '@/components/ReceivePaymentModal';
import { type Customer, useCustomers } from '@/data/mockCustomers';
import {
  type Invoice,
  calculateInvoiceBalance,
  calculateInvoiceTotal,
  formatInvoiceAmount,
  isInvoiceWaitingToBePaid,
  updateInvoiceStatus,
  useInvoices,
} from '@/data/mockInvoices';

type CustomerSummary = Customer & {
  invoices: Invoice[];
  totalRevenue: string;
  waitingToBePaid: string;
  invoiceCount: number;
  lastInvoiceDate: string;
};

function getInvoiceTime(invoice: Invoice) {
  const time = Date.parse(invoice.invoiceDate);
  return Number.isFinite(time) ? time : 0;
}

function getLastInvoiceDate(invoices: Invoice[]) {
  if (invoices.length === 0) {
    return 'No invoices yet';
  }

  return invoices.reduce((latest, invoice) => (getInvoiceTime(invoice) > getInvoiceTime(latest) ? invoice : latest))
    .invoiceDate;
}

function buildCustomerSummaries(customers: Customer[], invoices: Invoice[]): CustomerSummary[] {
  return customers.map((customer) => {
    const customerInvoices = invoices.filter((invoice) => invoice.customer === customer.name);
    const waitingInvoices = customerInvoices.filter(isInvoiceWaitingToBePaid);

    return {
      ...customer,
      invoices: customerInvoices,
      totalRevenue: formatInvoiceAmount(calculateInvoiceTotal(customerInvoices)),
      waitingToBePaid: formatInvoiceAmount(waitingInvoices.reduce((total, invoice) => total + calculateInvoiceBalance(invoice), 0)),
      invoiceCount: customerInvoices.length,
      lastInvoiceDate: getLastInvoiceDate(customerInvoices),
    };
  });
}

export default function CustomersScreen() {
  const customers = useCustomers();
  const invoices = useInvoices();
  const customerSummaries = useMemo(() => buildCustomerSummaries(customers, invoices), [customers, invoices]);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'All' | 'Owes Money' | 'Paid Up' | 'No Invoices'>('All');
  const [isPaymentModalVisible, setIsPaymentModalVisible] = useState(false);

  const visibleCustomerSummaries = useMemo(() => {
    return customerSummaries
      .filter((c) => {
        if (filter === 'Owes Money') return c.invoices.some(isInvoiceWaitingToBePaid);
        if (filter === 'Paid Up') return c.invoiceCount > 0 && !c.invoices.some(isInvoiceWaitingToBePaid);
        if (filter === 'No Invoices') return c.invoiceCount === 0;
        return true;
      })
      .filter((c) => {
        if (!query.trim()) return true;
        const q = query.toLowerCase();
        return (
          c.name.toLowerCase().includes(q) ||
          (c.contact ?? '').toLowerCase().includes(q) ||
          (c.email ?? '').toLowerCase().includes(q) ||
          (c.phone ?? '').toLowerCase().includes(q)
        );
      });
  }, [customerSummaries, filter, query]);
  const [selectedCustomerName, setSelectedCustomerName] = useState(customerSummaries[0]?.name ?? '');
  const selectedCustomer =
    customerSummaries.find((customer) => customer.name === selectedCustomerName) ?? customerSummaries[0];
  const selectedOpenInvoices = selectedCustomer?.invoices.filter((invoice) => calculateInvoiceBalance(invoice) > 0) ?? [];

  return (
    <AppShell activeNav="Customers">
      <View style={styles.pageHeader}>
        <View>
          <Text style={styles.eyebrow}>Customers</Text>
          <Text style={styles.heading}>Know who owes what.</Text>
        </View>

        <Pressable style={styles.newCustomerButton} onPress={() => router.push('/new-customer')}>
          <Text style={styles.newCustomerText}>+ New Customer</Text>
        </Pressable>
      </View>

      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search customers (company, contact, email, phone)"
          placeholderTextColor="#6b6b6b"
          value={query}
          onChangeText={setQuery}
        />

        <View style={styles.filterRow}>
          {(['All', 'Owes Money', 'Paid Up', 'No Invoices'] as const).map((f) => (
            <Pressable key={f} onPress={() => setFilter(f)} style={[styles.filterChip, filter === f && styles.filterChipActive]}>
              <Text style={[styles.filterChipText, filter === f && styles.filterChipTextActive]}>{f}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.customerCard}>
        <View style={styles.tableHeader}>
          <Text style={[styles.tableHeaderText, styles.customerColumn]}>Customer</Text>
          <Text style={[styles.tableHeaderText, styles.revenueColumn]}>Total Revenue</Text>
          <Text style={[styles.tableHeaderText, styles.waitingColumn]}>Waiting To Be Paid</Text>
          <Text style={[styles.tableHeaderText, styles.countColumn]}>Invoices</Text>
          <Text style={[styles.tableHeaderText, styles.dateColumn]}>Last Invoice</Text>
        </View>

        <View style={styles.customerList}>
          {visibleCustomerSummaries.map((customer) => {
            const isSelected = customer.name === selectedCustomer?.name;

            return (
              <Pressable
                key={customer.name}
                style={[styles.customerRow, isSelected && styles.customerRowActive]}
                onPress={() => setSelectedCustomerName(customer.name)}
              >
                <View style={styles.customerColumn}>
                  <Text style={styles.customerName}>{customer.name}</Text>
                  <Text style={styles.customerMeta}>{customer.contact}</Text>
                </View>
                <Text style={[styles.customerAmount, styles.revenueColumn]}>{customer.totalRevenue}</Text>
                <Text style={[styles.customerAmount, styles.waitingColumn]}>{customer.waitingToBePaid}</Text>
                <Text style={[styles.customerText, styles.countColumn]}>{customer.invoiceCount}</Text>
                <Text style={[styles.customerMeta, styles.dateColumn]}>{customer.lastInvoiceDate}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {selectedCustomer && (
        <View style={styles.detailCard}>
          <View style={styles.detailHeader}>
            <View>
              <Text style={styles.detailEyebrow}>Customer Detail</Text>
              <Text style={styles.detailTitle}>{selectedCustomer.name}</Text>
            </View>

            <View style={styles.detailTotals}>
              <Text style={styles.detailTotalLabel}>Waiting</Text>
              <Text style={styles.detailTotalValue}>{selectedCustomer.waitingToBePaid}</Text>
            </View>
          </View>

          <View style={styles.detailActions}>
            <Pressable
              style={styles.primaryActionButton}
              onPress={() => router.push(`/new-customer?customer=${encodeURIComponent(selectedCustomer.name)}`)}
            >
              <Text style={styles.primaryActionButtonText}>Edit Customer</Text>
            </Pressable>

            <Pressable
              style={styles.secondaryActionButton}
              onPress={() => router.push(`/new-invoice?customer=${encodeURIComponent(selectedCustomer.name)}`)}
            >
              <Text style={styles.secondaryActionButtonText}>Create Invoice</Text>
            </Pressable>

            <Pressable
              style={styles.secondaryActionButton}
              onPress={() => setIsPaymentModalVisible(true)}
            >
              <Text style={styles.secondaryActionButtonText}>Receive Payment</Text>
            </Pressable>
          </View>

          <View style={styles.infoGrid}>
            <InfoBlock label="Contact" value={selectedCustomer.contact} />
            <InfoBlock label="Phone" value={selectedCustomer.phone} />
            <InfoBlock label="Email" value={selectedCustomer.email} />
            <InfoBlock label="Address" value={selectedCustomer.address} />
          </View>

          <View style={styles.notesBlock}>
            <Text style={styles.infoLabel}>Notes</Text>
            <Text style={styles.infoValue}>{selectedCustomer.notes}</Text>
          </View>

          <View style={styles.invoiceSection}>
            <Text style={styles.sectionTitle}>Invoices</Text>

            <View style={styles.invoiceList}>
              {selectedCustomer.invoices.length > 0 ? (
                selectedCustomer.invoices.map((invoice) => {
                  const balance = calculateInvoiceBalance(invoice);

                  return (
                    <View key={invoice.invoice} style={styles.invoiceRow}>
                      <View style={styles.invoicePrimary}>
                        <Text style={styles.invoiceTitle}>#{invoice.invoice}</Text>
                        <Text style={styles.invoiceSubtitle}>{invoice.invoiceDate}</Text>
                      </View>

                      <View style={styles.statusPill}>
                        <Text style={styles.statusText}>{invoice.status}</Text>
                      </View>

                      <View style={styles.invoiceAmountBlock}>
                        <Text style={styles.invoiceAmount}>{formatInvoiceAmount(balance)}</Text>
                        <Text style={styles.invoiceSubtitle}>of {invoice.amount}</Text>
                      </View>

                      {balance > 0 && (
                        <Pressable
                          style={styles.markPaidButton}
                          onPress={() => updateInvoiceStatus(invoice.invoice, 'Paid')}
                        >
                          <Text style={styles.markPaidButtonText}>Mark Paid</Text>
                        </Pressable>
                      )}
                    </View>
                  );
                })
              ) : (
                <View style={styles.emptyRow}>
                  <Text style={styles.emptyText}>No invoices for this customer yet.</Text>
                </View>
              )}
            </View>
          </View>
        </View>
      )}

      <ReceivePaymentModal
        invoices={selectedOpenInvoices}
        visible={isPaymentModalVisible}
        onClose={() => setIsPaymentModalVisible(false)}
      />
    </AppShell>
  );
}

function InfoBlock({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.infoBlock}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
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
  newCustomerButton: {
    backgroundColor: '#f97316',
    borderRadius: 16,
    paddingHorizontal: 22,
    paddingVertical: 14,
    shadowColor: '#f97316',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.2,
    shadowRadius: 24,
  },
  newCustomerText: {
    color: '#111111',
    fontSize: 16,
    fontWeight: '900',
  },
  customerCard: {
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
  customerList: {
    gap: 12,
    marginTop: 16,
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
  filterRow: { flexDirection: 'row', gap: 8, marginTop: 10, flexWrap: 'wrap' },
  filterChip: {
    backgroundColor: '#252525',
    borderColor: '#353535',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  filterChipActive: { backgroundColor: 'rgba(249,115,22,0.14)', borderColor: 'rgba(249,115,22,0.4)' },
  filterChipText: { color: '#d4d4d4', fontWeight: '800' },
  filterChipTextActive: { color: '#f97316' },
  customerRow: {
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
  customerRowActive: {
    borderColor: 'rgba(249, 115, 22, 0.52)',
  },
  customerColumn: {
    flex: 1.7,
  },
  revenueColumn: {
    flex: 1,
  },
  waitingColumn: {
    flex: 1.1,
  },
  countColumn: {
    flex: 0.6,
  },
  dateColumn: {
    flex: 1,
  },
  customerName: {
    color: '#f5f5f5',
    fontSize: 16,
    fontWeight: '800',
  },
  customerText: {
    color: '#f5f5f5',
    fontSize: 15,
    fontWeight: '700',
  },
  customerMeta: {
    color: '#a3a3a3',
    fontSize: 14,
    fontWeight: '600',
    marginTop: 3,
  },
  customerAmount: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '900',
  },
  detailCard: {
    backgroundColor: '#1e1e1e',
    borderColor: '#323232',
    borderRadius: 22,
    borderWidth: 1,
    marginTop: 24,
    padding: 28,
  },
  detailHeader: {
    alignItems: 'center',
    borderBottomColor: '#323232',
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 18,
    paddingBottom: 18,
  },
  detailEyebrow: {
    color: '#f97316',
    fontSize: 13,
    fontWeight: '900',
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  detailTitle: {
    color: '#ffffff',
    fontSize: 28,
    fontWeight: '900',
  },
  detailTotals: {
    alignItems: 'flex-end',
  },
  detailActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 18,
  },
  primaryActionButton: {
    backgroundColor: '#f97316',
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingVertical: 14,
    shadowColor: '#f97316',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.2,
    shadowRadius: 24,
  },
  primaryActionButtonText: {
    color: '#111111',
    fontSize: 15,
    fontWeight: '900',
  },
  secondaryActionButton: {
    backgroundColor: '#252525',
    borderColor: '#343434',
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  secondaryActionButtonText: {
    color: '#d4d4d4',
    fontSize: 15,
    fontWeight: '900',
  },
  detailTotalLabel: {
    color: '#a3a3a3',
    fontSize: 13,
    fontWeight: '800',
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  detailTotalValue: {
    color: '#ffffff',
    fontSize: 28,
    fontWeight: '900',
  },
  infoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
  },
  infoBlock: {
    backgroundColor: '#252525',
    borderColor: '#353535',
    borderRadius: 14,
    borderWidth: 1,
    flexBasis: '24%',
    flexGrow: 1,
    padding: 14,
  },
  infoLabel: {
    color: '#737373',
    fontSize: 12,
    fontWeight: '900',
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  infoValue: {
    color: '#f5f5f5',
    fontSize: 15,
    fontWeight: '700',
  },
  notesBlock: {
    backgroundColor: '#252525',
    borderColor: '#353535',
    borderRadius: 14,
    borderWidth: 1,
    marginTop: 14,
    padding: 14,
  },
  invoiceSection: {
    marginTop: 22,
  },
  sectionTitle: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '900',
    marginBottom: 14,
  },
  invoiceList: {
    gap: 12,
  },
  invoiceRow: {
    alignItems: 'center',
    backgroundColor: '#252525',
    borderColor: '#353535',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  invoicePrimary: {
    flex: 1,
  },
  invoiceTitle: {
    color: '#f5f5f5',
    fontSize: 16,
    fontWeight: '800',
  },
  invoiceSubtitle: {
    color: '#a3a3a3',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 3,
  },
  statusPill: {
    backgroundColor: 'rgba(249, 115, 22, 0.12)',
    borderColor: 'rgba(249, 115, 22, 0.42)',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  statusText: {
    color: '#f97316',
    fontSize: 13,
    fontWeight: '900',
  },
  invoiceAmount: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '900',
  },
  invoiceAmountBlock: {
    alignItems: 'flex-end',
  },
  markPaidButton: {
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
  emptyRow: {
    backgroundColor: '#252525',
    borderColor: '#353535',
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  emptyText: {
    color: '#a3a3a3',
    fontSize: 15,
    fontWeight: '700',
  },
});
