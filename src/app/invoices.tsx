import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { AppShell } from '@/components/AppShell';
import { ReceivePaymentModal } from '@/components/ReceivePaymentModal';
import {
  addInvoiceAttachment,
  calculateInvoiceBalance,
  deleteInvoiceAttachment,
  formatInvoiceAmount,
  type InvoiceAttachment,
  type InvoiceStatus,
  reattachInvoiceAttachment,
  useInvoices,
} from '@/data/mockInvoices';

function formatFileSize(size?: number) {
  if (!size) return 'Size unknown';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatUploadDate(dateAdded: string) {
  const parsed = Date.parse(dateAdded);
  return Number.isFinite(parsed) ? new Date(parsed).toLocaleDateString() : dateAdded;
}

function pickInvoiceAttachment(invoiceNumber: string, attachmentId?: string) {
  if (typeof document === 'undefined' || typeof URL === 'undefined') {
    if (!attachmentId) {
      addInvoiceAttachment(invoiceNumber);
    }
    return;
  }

  const input = document.createElement('input');
  input.type = 'file';
  input.onchange = () => {
    const file = input.files?.[0];
    if (!file) return;

    const attachmentInput = {
      name: file.name,
      type: file.type || 'application/octet-stream',
      size: file.size,
      objectUrl: URL.createObjectURL(file),
    };

    if (attachmentId) {
      reattachInvoiceAttachment(invoiceNumber, attachmentId, attachmentInput);
    } else {
      addInvoiceAttachment(invoiceNumber, attachmentInput);
    }
  };
  input.click();
}

function viewAttachment(attachment: InvoiceAttachment) {
  if (typeof window === 'undefined' || !attachment.objectUrl) {
    return;
  }

  window.open(attachment.objectUrl, '_blank', 'noopener,noreferrer');
}

function getStatusPillStyle(status: InvoiceStatus) {
  return [
    styles.statusPill,
    status === 'Draft' && styles.statusPillDraft,
    status === 'Sent' && styles.statusPillSent,
    status === 'Paid' && styles.statusPillPaid,
    status === 'Due Today' && styles.statusPillDueToday,
    status === 'Overdue' && styles.statusPillOverdue,
  ];
}

function getStatusTextStyle(status: InvoiceStatus) {
  return [
    styles.statusText,
    status === 'Draft' && styles.statusTextDraft,
    status === 'Sent' && styles.statusTextSent,
    status === 'Paid' && styles.statusTextPaid,
    status === 'Due Today' && styles.statusTextDueToday,
    status === 'Overdue' && styles.statusTextOverdue,
  ];
}

export default function InvoicesScreen() {
  const invoices = useInvoices();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'All' | 'Draft' | 'Sent' | 'Paid' | 'Overdue'>('All');
  const [paymentInvoiceNumber, setPaymentInvoiceNumber] = useState('');
  const paymentInvoice = invoices.find((invoice) => invoice.invoice === paymentInvoiceNumber);

  const visibleInvoices = useMemo(() => {
    return invoices
      .filter((inv) => {
        if (filter !== 'All') {
          if (filter === 'Overdue') return inv.status === 'Overdue';
          return inv.status === filter;
        }
        return true;
      })
      .filter((inv) => {
        if (!query.trim()) return true;
        const q = query.toLowerCase();
        return (
          inv.invoice.toLowerCase().includes(q) ||
          inv.customer.toLowerCase().includes(q) ||
          (inv.poNumber ?? '').toLowerCase().includes(q) ||
          (inv.bolNumber ?? '').toLowerCase().includes(q)
        );
      });
  }, [invoices, query, filter]);

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
      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search invoices (number, customer, PO, BOL)"
          placeholderTextColor="#6b6b6b"
          value={query}
          onChangeText={setQuery}
        />

        <View style={styles.filterRow}>
          {(['All', 'Draft', 'Sent', 'Paid', 'Overdue'] as const).map((f) => (
            <Pressable
              key={f}
              onPress={() => setFilter(f)}
              style={[styles.filterChip, filter === f && styles.filterChipActive]}
            >
              <Text style={[styles.filterChipText, filter === f && styles.filterChipTextActive]}>{f}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.invoiceCard}>
        <View style={styles.tableHeader}>
          <Text style={[styles.tableHeaderText, styles.invoiceColumn]}>Invoice #</Text>
          <Text style={[styles.tableHeaderText, styles.customerColumn]}>Customer</Text>
          <Text style={[styles.tableHeaderText, styles.amountColumn]}>Amount</Text>
          <Text style={[styles.tableHeaderText, styles.statusColumn]}>Status</Text>
          <Text style={[styles.tableHeaderText, styles.dateColumn]}>Invoice Date</Text>
          <Text style={[styles.tableHeaderText, styles.dateColumn]}>Due Date</Text>
          <Text style={[styles.tableHeaderText, styles.actionColumn]}>Action</Text>
        </View>

        <View style={styles.invoiceList}>
          {visibleInvoices.map((invoice, index) => {
            const balance = calculateInvoiceBalance(invoice);

            return (
              <View key={`${invoice.invoice}-${index}`} style={styles.invoiceItem}>
                <View style={styles.invoiceRow}>
                  <Text style={[styles.invoiceText, styles.invoiceColumn]}>#{invoice.invoice}</Text>
                  <Text style={[styles.invoiceText, styles.customerColumn]}>{invoice.customer}</Text>
                  <View style={styles.amountColumn}>
                    <Text style={styles.invoiceAmount}>{formatInvoiceAmount(balance)}</Text>
                    <Text style={styles.invoiceMeta}>of {invoice.amount}</Text>
                  </View>
                  <View style={styles.statusColumn}>
                    <View style={getStatusPillStyle(invoice.status)}>
                      <Text style={getStatusTextStyle(invoice.status)}>{invoice.status}</Text>
                    </View>
                  </View>
                  <Text style={[styles.invoiceMeta, styles.dateColumn]}>{invoice.invoiceDate}</Text>
                  <Text style={[styles.invoiceMeta, styles.dateColumn]}>{(function () {
                    // compute due date
                    try {
                      const dt = Date.parse(invoice.invoiceDate);
                      if (!isNaN(dt)) {
                        const date = new Date(dt);
                        const m = (invoice.terms || '').match(/(\d+)/);
                        const days = m ? Number(m[1]) : 0;
                        date.setDate(date.getDate() + days);
                        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                      }
                    } catch {}
                    return '';
                  })()}</Text>
                  <View style={styles.actionColumn}>
                    <Pressable style={styles.editButton} onPress={() => router.push(`/new-invoice?invoice=${encodeURIComponent(invoice.invoice)}`)}>
                      <Text style={styles.editButtonText}>Edit</Text>
                    </Pressable>
                    {balance > 0 && (
                      <Pressable style={styles.receivePaymentButton} onPress={() => setPaymentInvoiceNumber(invoice.invoice)}>
                        <Text style={styles.receivePaymentButtonText}>Receive Payment</Text>
                      </Pressable>
                    )}
                    {balance <= 0 && <Text style={styles.paidActionText}>Paid</Text>}
                  </View>
                </View>

                <View style={styles.attachmentSection}>
                  <View style={styles.attachmentHeader}>
                    <View>
                      <Text style={styles.attachmentTitle}>Attachments</Text>
                      <Text style={styles.attachmentMeta}>Local file preview is temporary until cloud storage is added.</Text>
                    </View>

                    <Pressable style={styles.attachFileButton} onPress={() => pickInvoiceAttachment(invoice.invoice)}>
                      <Text style={styles.attachFileButtonText}>Attach File</Text>
                    </Pressable>
                  </View>

                  <View style={styles.attachmentList}>
                    {(invoice.attachments ?? []).length > 0 ? (
                      invoice.attachments?.map((attachment) => (
                        <View key={attachment.id} style={styles.attachmentRow}>
                          <View style={styles.attachmentCopy}>
                            <Text style={styles.attachmentName}>{attachment.name}</Text>
                            <Text style={styles.attachmentMeta}>
                              {attachment.type} • {formatFileSize(attachment.size)} • Uploaded {formatUploadDate(attachment.dateAdded)}
                            </Text>
                            {!attachment.objectUrl && (
                              <Text style={styles.attachmentNeedsText}>
                                Preview unavailable after browser refresh.
                              </Text>
                            )}
                          </View>

                          <View style={styles.attachmentActions}>
                            {attachment.objectUrl ? (
                              <Pressable
                                style={styles.attachmentActionButton}
                                onPress={() => viewAttachment(attachment)}
                              >
                                <Text style={styles.attachmentActionButtonText}>View</Text>
                              </Pressable>
                            ) : (
                              <Pressable
                                style={styles.attachmentActionButton}
                                onPress={() => pickInvoiceAttachment(invoice.invoice, attachment.id)}
                              >
                                <Text style={styles.attachmentActionButtonText}>Upload Again</Text>
                              </Pressable>
                            )}

                            <Pressable
                              style={styles.attachmentActionButton}
                              onPress={() => deleteInvoiceAttachment(invoice.invoice, attachment.id)}
                            >
                              <Text style={styles.attachmentActionButtonText}>Delete</Text>
                            </Pressable>
                          </View>
                        </View>
                      ))
                    ) : (
                      <Text style={styles.attachmentEmptyText}>
                        No paperwork attached yet. Use Attach File to save filename, type, size, and upload date locally.
                      </Text>
                    )}
                  </View>
                </View>
              </View>
            );
          })}
        </View>
      </View>

      <ReceivePaymentModal
        invoices={paymentInvoice ? [paymentInvoice] : []}
        visible={!!paymentInvoice}
        onClose={() => setPaymentInvoiceNumber('')}
      />
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
  invoiceItem: {
    gap: 10,
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
  statusPillDueToday: {
    backgroundColor: 'rgba(250, 204, 21, 0.12)',
    borderColor: 'rgba(250, 204, 21, 0.36)',
  },
  statusTextDueToday: {
    color: '#facc15',
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
  receivePaymentButton: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(249, 115, 22, 0.12)',
    borderColor: 'rgba(249, 115, 22, 0.36)',
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  receivePaymentButtonText: {
    color: '#fdba74',
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
  attachmentSection: {
    backgroundColor: '#252525',
    borderColor: '#353535',
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
  },
  attachmentHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 16,
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  attachmentTitle: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '900',
  },
  attachmentList: {
    gap: 8,
  },
  attachmentRow: {
    alignItems: 'center',
    backgroundColor: '#1f1f1f',
    borderColor: '#343434',
    borderRadius: 12,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  attachmentCopy: {
    flex: 1,
    gap: 4,
  },
  attachmentName: {
    color: '#f5f5f5',
    fontSize: 14,
    fontWeight: '800',
  },
  attachmentMeta: {
    color: '#a3a3a3',
    fontSize: 12,
    fontWeight: '700',
  },
  attachmentNeedsText: {
    color: '#f97316',
    fontSize: 12,
    fontWeight: '900',
  },
  attachmentEmptyText: {
    color: '#a3a3a3',
    fontSize: 14,
    fontWeight: '700',
  },
  attachFileButton: {
    backgroundColor: 'rgba(249, 115, 22, 0.12)',
    borderColor: 'rgba(249, 115, 22, 0.36)',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  attachFileButtonText: {
    color: '#fdba74',
    fontSize: 13,
    fontWeight: '900',
  },
  attachmentActions: {
    flexDirection: 'row',
    gap: 8,
  },
  attachmentActionButton: {
    backgroundColor: '#252525',
    borderColor: '#343434',
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  attachmentActionButtonText: {
    color: '#d4d4d4',
    fontSize: 12,
    fontWeight: '900',
  },
});
