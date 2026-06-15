import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  type Invoice,
  calculateInvoiceBalance,
  formatInvoiceAmount,
  receiveInvoicePayment,
} from '@/data/mockInvoices';

function formatInputDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function parsePaymentAmount(amount: string) {
  const parsedAmount = Number(amount.replace(/[$,]/g, '').trim());
  return Number.isFinite(parsedAmount) ? parsedAmount : 0;
}

export function ReceivePaymentModal({
  invoices,
  onClose,
  visible,
}: {
  invoices: Invoice[];
  onClose: () => void;
  visible: boolean;
}) {
  const payableInvoices = useMemo(
    () => invoices.filter((invoice) => calculateInvoiceBalance(invoice) > 0),
    [invoices]
  );
  const [selectedInvoiceNumber, setSelectedInvoiceNumber] = useState('');
  const [amount, setAmount] = useState('');
  const [dateReceived, setDateReceived] = useState(formatInputDate(new Date()));
  const [notes, setNotes] = useState('');

  const selectedInvoice = payableInvoices.find((invoice) => invoice.invoice === selectedInvoiceNumber) ?? payableInvoices[0];
  const selectedBalance = selectedInvoice ? calculateInvoiceBalance(selectedInvoice) : 0;
  const amountReceived = parsePaymentAmount(amount);
  const hasValidDate = Number.isFinite(Date.parse(dateReceived));
  const canSubmit = !!selectedInvoice && amountReceived > 0 && amountReceived <= selectedBalance && hasValidDate;

  useEffect(() => {
    if (!visible) {
      return;
    }

    const firstInvoice = payableInvoices[0];
    setSelectedInvoiceNumber(firstInvoice?.invoice ?? '');
    setAmount(firstInvoice ? String(calculateInvoiceBalance(firstInvoice)) : '');
    setDateReceived(formatInputDate(new Date()));
    setNotes('');
  }, [payableInvoices, visible]);

  function selectInvoice(invoice: Invoice) {
    setSelectedInvoiceNumber(invoice.invoice);
    setAmount(String(calculateInvoiceBalance(invoice)));
  }

  function submitPayment() {
    if (!selectedInvoice || !canSubmit) {
      return;
    }

    receiveInvoicePayment(selectedInvoice.invoice, {
      amount: amountReceived,
      date: dateReceived,
      notes,
    });
    onClose();
  }

  return (
    <Modal animationType="fade" transparent visible={visible} onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <View style={styles.header}>
            <View>
              <Text style={styles.eyebrow}>Receive Payment</Text>
              <Text style={styles.title}>Record money received.</Text>
            </View>

            <Pressable style={styles.closeButton} onPress={onClose}>
              <Text style={styles.closeButtonText}>Close</Text>
            </Pressable>
          </View>

          {payableInvoices.length > 0 ? (
            <>
              <View style={styles.invoiceList}>
                {payableInvoices.map((invoice) => {
                  const isSelected = invoice.invoice === selectedInvoice?.invoice;

                  return (
                    <Pressable
                      key={invoice.invoice}
                      style={[styles.invoiceOption, isSelected && styles.invoiceOptionActive]}
                      onPress={() => selectInvoice(invoice)}
                    >
                      <View>
                        <Text style={styles.invoiceTitle}>#{invoice.invoice} {invoice.customer}</Text>
                        <Text style={styles.invoiceMeta}>Balance {formatInvoiceAmount(calculateInvoiceBalance(invoice))}</Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>

              <View style={styles.fieldGrid}>
                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>Amount Received</Text>
                  <TextInput
                    style={styles.input}
                    keyboardType="decimal-pad"
                    placeholder="0.00"
                    placeholderTextColor="#6b6b6b"
                    value={amount}
                    onChangeText={setAmount}
                  />
                </View>

                <View style={styles.field}>
                  <Text style={styles.fieldLabel}>Date Received</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor="#6b6b6b"
                    value={dateReceived}
                    onChangeText={setDateReceived}
                  />
                </View>
              </View>

              <View style={styles.field}>
                <Text style={styles.fieldLabel}>Notes</Text>
                <TextInput
                  multiline
                  style={[styles.input, styles.notesInput]}
                  placeholder="Optional"
                  placeholderTextColor="#6b6b6b"
                  value={notes}
                  onChangeText={setNotes}
                />
              </View>

              <View style={styles.footer}>
                <Text style={styles.helperText}>Remaining balance: {formatInvoiceAmount(Math.max(selectedBalance - amountReceived, 0))}</Text>
                <Pressable
                  disabled={!canSubmit}
                  style={[styles.submitButton, !canSubmit && styles.submitButtonDisabled]}
                  onPress={submitPayment}
                >
                  <Text style={styles.submitButtonText}>Save Payment</Text>
                </Pressable>
              </View>
            </>
          ) : (
            <View style={styles.emptyRow}>
              <Text style={styles.emptyText}>No open invoice balance to receive.</Text>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.62)',
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  card: {
    backgroundColor: '#1e1e1e',
    borderColor: '#323232',
    borderRadius: 22,
    borderWidth: 1,
    maxWidth: 680,
    padding: 28,
    width: '100%',
  },
  header: {
    alignItems: 'flex-start',
    borderBottomColor: '#323232',
    borderBottomWidth: 1,
    flexDirection: 'row',
    gap: 16,
    justifyContent: 'space-between',
    marginBottom: 18,
    paddingBottom: 18,
  },
  eyebrow: {
    color: '#f97316',
    fontSize: 13,
    fontWeight: '900',
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  title: {
    color: '#ffffff',
    fontSize: 24,
    fontWeight: '900',
  },
  closeButton: {
    backgroundColor: '#252525',
    borderColor: '#343434',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  closeButtonText: {
    color: '#d4d4d4',
    fontSize: 13,
    fontWeight: '900',
  },
  invoiceList: {
    gap: 10,
    marginBottom: 16,
  },
  invoiceOption: {
    backgroundColor: '#252525',
    borderColor: '#353535',
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  invoiceOptionActive: {
    borderColor: 'rgba(249, 115, 22, 0.52)',
  },
  invoiceTitle: {
    color: '#f5f5f5',
    fontSize: 16,
    fontWeight: '800',
  },
  invoiceMeta: {
    color: '#a3a3a3',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 3,
  },
  fieldGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  field: {
    flex: 1,
    marginBottom: 14,
  },
  fieldLabel: {
    color: '#737373',
    fontSize: 12,
    fontWeight: '900',
    marginBottom: 6,
    textTransform: 'uppercase',
  },
  input: {
    backgroundColor: '#252525',
    borderColor: '#353535',
    borderRadius: 10,
    borderWidth: 1,
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '700',
    padding: 12,
  },
  notesInput: {
    minHeight: 88,
    textAlignVertical: 'top',
  },
  footer: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 16,
    justifyContent: 'space-between',
  },
  helperText: {
    color: '#a3a3a3',
    fontSize: 14,
    fontWeight: '700',
  },
  submitButton: {
    backgroundColor: '#f97316',
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  submitButtonDisabled: {
    opacity: 0.45,
  },
  submitButtonText: {
    color: '#111111',
    fontSize: 14,
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
