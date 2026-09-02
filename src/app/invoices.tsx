import { router } from 'expo-router';
import Head from 'expo-router/head';
import { useMemo, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';

import { AppShell } from '@/components/AppShell';
import { ReceivePaymentModal } from '@/components/ReceivePaymentModal';
import { useBusinessProfile } from '@/data/mockBusiness';
import { useCustomers } from '@/data/mockCustomers';
import {
    addInvoiceAttachment,
    calculateInvoiceBalance,
    deleteInvoiceAttachment,
    formatInvoiceAmount,
    getInvoiceAttachmentViewUrl,
    type Invoice,
    type InvoiceAttachment,
    type InvoiceStatus,
    reattachInvoiceAttachment,
    uploadInvoiceAttachmentFile,
    useInvoices,
} from '@/data/mockInvoices';
import { getCurrentUserId } from '@/data/authStore';
import { formatDateDisplay, formatDueDateDisplay } from '@/utils/date';

function formatFileSize(size?: number) {
  if (!size) return 'Size unknown';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatUploadDate(dateAdded: string) {
  return formatDateDisplay(dateAdded);
}

function pickInvoiceAttachment(invoiceId: string, attachmentId?: string) {
  if (typeof document === 'undefined' || typeof URL === 'undefined') {
    if (!attachmentId) {
      addInvoiceAttachment(invoiceId);
    }
    return;
  }

  const input = document.createElement('input');
  input.type = 'file';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;

    const userId = getCurrentUserId();
    let storagePath: string | undefined;
    if (userId) {
      try {
        storagePath = await uploadInvoiceAttachmentFile(userId, invoiceId, file);
      } catch {
        window.alert('Could not upload the file. Please try again.');
        return;
      }
    }

    const attachmentInput = {
      name: file.name,
      type: file.type || 'application/octet-stream',
      size: file.size,
      objectUrl: URL.createObjectURL(file),
      storagePath,
    };

    if (attachmentId) {
      reattachInvoiceAttachment(invoiceId, attachmentId, attachmentInput);
    } else {
      addInvoiceAttachment(invoiceId, attachmentInput);
    }
  };
  input.click();
}

async function viewAttachment(attachment: InvoiceAttachment) {
  if (typeof window === 'undefined') {
    return;
  }

  const url = await getInvoiceAttachmentViewUrl(attachment);
  if (!url) {
    window.alert('This file is no longer available. Try uploading it again.');
    return;
  }

  window.open(url, '_blank', 'noopener,noreferrer');
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

function buildInvoiceDueDate(invoice: { invoiceDate: string; terms?: string }) {
  return formatDueDateDisplay(invoice.invoiceDate, invoice.terms);
}

function buildInvoiceMailto(invoice: Invoice, customerEmail: string, businessName: string) {
  const amountDue = formatInvoiceAmount(calculateInvoiceBalance(invoice as any));
  const dueDate = buildInvoiceDueDate(invoice);
  const subject = `Invoice #${invoice.invoice} from ${businessName}`;
  const bodyLines = [
    `Hello ${invoice.customer},`,
    '',
    `Please find invoice #${invoice.invoice} for ${amountDue}.`,
    `Due date: ${dueDate || formatDateDisplay(invoice.invoiceDate)}`,
    '',
    `Thank you for your business.`,
    businessName,
  ];
  const body = encodeURIComponent(bodyLines.join('\n'));
  return `mailto:${encodeURIComponent(customerEmail)}?subject=${encodeURIComponent(subject)}&body=${body}`;
}

function openMailTo(href: string) {
  Linking.openURL(href).catch(() => {
    // swallow errors for unsupported environments
  });
}

export default function InvoicesScreen() {
  const { width } = useWindowDimensions();
  const isCompact = width < 760;
  const invoices = useInvoices();
  const customers = useCustomers();
  const profile = useBusinessProfile();
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'All' | 'Draft' | 'Sent' | 'Paid' | 'Overdue'>('All');
  const [paymentInvoiceId, setPaymentInvoiceId] = useState('');
  const paymentInvoice = invoices.find((invoice) => invoice.id === paymentInvoiceId);

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
      <Head>
        <title>Invoices | Blue Collar Books</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <View style={styles.pageHeader}>
        <View style={styles.pageHeaderText}>
          <Text style={styles.eyebrow}>Invoices</Text>
          <Text style={[styles.heading, isCompact && styles.headingCompact]}>Get paid without chasing paperwork.</Text>
        </View>

        <Pressable style={styles.newInvoiceButton} onPress={() => router.push('/new-invoice')}>
          <Text style={styles.newInvoiceText}>+ Make Invoice</Text>
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

      <View style={[styles.invoiceCard, isCompact && styles.invoiceCardCompact]}>
        {!isCompact && (
          <View style={styles.tableHeader}>
            <Text style={[styles.tableHeaderText, styles.invoiceColumn]}>Invoice #</Text>
            <Text style={[styles.tableHeaderText, styles.customerColumn]}>Customer</Text>
            <Text style={[styles.tableHeaderText, styles.amountColumn]}>Amount</Text>
            <Text style={[styles.tableHeaderText, styles.statusColumn]}>Status</Text>
            <Text style={[styles.tableHeaderText, styles.dateColumn]}>Date Sent</Text>
            <Text style={[styles.tableHeaderText, styles.dateColumn]}>Due Date</Text>
            <Text style={[styles.tableHeaderText, styles.actionColumn]}>Tools</Text>
          </View>
        )}

        <View style={styles.invoiceList}>
          {visibleInvoices.map((invoice) => {
            const balance = calculateInvoiceBalance(invoice);
          const customerEmail = customers.find((customer) =>
            invoice.customerId ? customer.id === invoice.customerId : customer.name === invoice.customer
          )?.email;

            const actionButtons = (
              <>
                <Pressable style={styles.editButton} onPress={() => router.push(`/new-invoice?invoiceId=${encodeURIComponent(invoice.id)}`)}>
                  <Text style={styles.editButtonText}>Edit</Text>
                </Pressable>
                <Pressable
                  disabled={!customerEmail}
                  style={[styles.emailButton, !customerEmail && styles.emailButtonDisabled]}
                  onPress={() => customerEmail && openMailTo(buildInvoiceMailto(invoice, customerEmail, profile.businessName))}
                >
                  <Text style={[styles.emailButtonText, !customerEmail && styles.emailButtonTextDisabled]}>
                    {customerEmail ? 'Email Invoice' : 'No email'}
                  </Text>
                </Pressable>
                {balance > 0 && (
                  <Pressable style={styles.receivePaymentButton} onPress={() => setPaymentInvoiceId(invoice.id)}>
                    <Text style={styles.receivePaymentButtonText}>Record Payment</Text>
                  </Pressable>
                )}
                {balance <= 0 && <Text style={styles.paidActionText}>Paid</Text>}
              </>
            );

            return (
              <View key={invoice.id} style={styles.invoiceItem}>
                {isCompact ? (
                  <View style={styles.invoiceRowCompact}>
                    <View style={styles.invoiceRowCompactTop}>
                      <Text style={styles.invoiceText}>#{invoice.invoice} {invoice.customer}</Text>
                      <View style={getStatusPillStyle(invoice.status)}>
                        <Text style={getStatusTextStyle(invoice.status)}>{invoice.status}</Text>
                      </View>
                    </View>
                    <View style={styles.invoiceRowCompactTop}>
                      <View>
                        <Text style={styles.invoiceAmount}>{formatInvoiceAmount(balance)}</Text>
                        <Text style={styles.invoiceMeta}>of {formatInvoiceAmount(invoice.amount)}</Text>
                      </View>
                      <View style={styles.invoiceRowCompactDates}>
                        <Text style={styles.invoiceMeta}>Sent {formatDateDisplay(invoice.invoiceDate)}</Text>
                        <Text style={styles.invoiceMeta}>Due {buildInvoiceDueDate(invoice)}</Text>
                      </View>
                    </View>
                    <View style={styles.actionColumnCompact}>{actionButtons}</View>
                  </View>
                ) : (
                  <View style={styles.invoiceRow}>
                    <Text style={[styles.invoiceText, styles.invoiceColumn]}>#{invoice.invoice}</Text>
                    <Text style={[styles.invoiceText, styles.customerColumn]}>{invoice.customer}</Text>
                    <View style={styles.amountColumn}>
                      <Text style={styles.invoiceAmount}>{formatInvoiceAmount(balance)}</Text>
                      <Text style={styles.invoiceMeta}>of {formatInvoiceAmount(invoice.amount)}</Text>
                    </View>
                    <View style={styles.statusColumn}>
                      <View style={getStatusPillStyle(invoice.status)}>
                        <Text style={getStatusTextStyle(invoice.status)}>{invoice.status}</Text>
                      </View>
                    </View>
                    <Text style={[styles.invoiceMeta, styles.dateColumn]}>{formatDateDisplay(invoice.invoiceDate)}</Text>
                    <Text style={[styles.invoiceMeta, styles.dateColumn]}>{buildInvoiceDueDate(invoice)}</Text>
                    <View style={styles.actionColumn}>{actionButtons}</View>
                  </View>
                )}

                <View style={styles.attachmentSection}>
                  <View style={styles.attachmentHeader}>
                    <View>
                      <Text style={styles.attachmentTitle}>📎 Attachments</Text>
                    </View>

                    <Pressable style={styles.attachFileButton} onPress={() => pickInvoiceAttachment(invoice.id)}>
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
                            {!attachment.objectUrl && !attachment.storagePath && (
                              <Text style={styles.attachmentNeedsText}>
                                File unavailable - please upload it again.
                              </Text>
                            )}
                          </View>

                          <View style={styles.attachmentActions}>
                            {(attachment.objectUrl || attachment.storagePath) ? (
                              <Pressable
                                style={styles.attachmentActionButton}
                                onPress={() => viewAttachment(attachment)}
                              >
                                <Text style={styles.attachmentActionButtonText}>View</Text>
                              </Pressable>
                            ) : (
                              <Pressable
                                style={styles.attachmentActionButton}
                                onPress={() => pickInvoiceAttachment(invoice.id, attachment.id)}
                              >
                                <Text style={styles.attachmentActionButtonText}>Upload Again</Text>
                              </Pressable>
                            )}

                            <Pressable
                              style={styles.attachmentActionButton}
                              onPress={() => deleteInvoiceAttachment(invoice.id, attachment.id)}
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
        onClose={() => setPaymentInvoiceId('')}
      />
    </AppShell>
  );
}

const styles = StyleSheet.create({
  pageHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 24,
    justifyContent: 'space-between',
    marginBottom: 28,
  },
  pageHeaderText: {
    flexShrink: 1,
    minWidth: 0,
  },
  eyebrow: {
    color: '#ff7a00',
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
  headingCompact: {
    fontSize: 24,
  },
  newInvoiceButton: {
    backgroundColor: '#ff7a00',
    borderRadius: 16,
    paddingHorizontal: 22,
    paddingVertical: 14,
    shadowColor: '#ff7a00',
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
  invoiceCardCompact: {
    padding: 16,
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
  filterChipTextActive: { color: '#ff7a00' },
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
  invoiceRowCompact: {
    backgroundColor: '#252525',
    borderColor: '#353535',
    borderRadius: 14,
    borderWidth: 1,
    gap: 10,
    padding: 16,
  },
  invoiceRowCompactTop: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'space-between',
  },
  invoiceRowCompactDates: {
    alignItems: 'flex-end',
  },
  actionColumnCompact: {
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 4,
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
    backgroundColor: 'rgba(67, 160, 71, 0.12)',
    borderColor: 'rgba(67, 160, 71, 0.36)',
  },
  statusPillOverdue: {
    backgroundColor: 'rgba(198, 40, 40, 0.12)',
    borderColor: 'rgba(198, 40, 40, 0.42)',
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
    color: '#7fd884',
  },
  statusTextOverdue: {
    color: '#e57373',
  },
  receivePaymentButton: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255, 122, 0, 0.12)',
    borderColor: 'rgba(255, 122, 0, 0.36)',
    borderRadius: 12,
    borderWidth: 1,
    marginBottom: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  receivePaymentButtonText: {
    color: '#ffb15c',
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
  emailButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#252525',
    borderColor: '#343434',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 8,
  },
  emailButtonDisabled: {
    opacity: 0.45,
  },
  editButtonText: {
    color: '#d4d4d4',
    fontSize: 13,
    fontWeight: '900',
  },
  emailButtonText: {
    color: '#d4d4d4',
    fontSize: 13,
    fontWeight: '900',
  },
  emailButtonTextDisabled: {
    color: '#8c8c8c',
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
    flexWrap: 'wrap',
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
    color: '#ff7a00',
    fontSize: 12,
    fontWeight: '900',
  },
  attachmentEmptyText: {
    color: '#a3a3a3',
    fontSize: 14,
    fontWeight: '700',
  },
  attachFileButton: {
    backgroundColor: 'rgba(255, 122, 0, 0.12)',
    borderColor: 'rgba(255, 122, 0, 0.36)',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  attachFileButtonText: {
    color: '#ffb15c',
    fontSize: 13,
    fontWeight: '900',
  },
  attachmentActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
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
