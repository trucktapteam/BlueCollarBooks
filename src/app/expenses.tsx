import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { AppShell } from '@/components/AppShell';
import {
  attachExpenseReceipt,
  calculateTotalMonthlyExpenses,
  deleteExpenseReceipt,
  type ExpenseReceipt,
  reattachExpenseReceipt,
  useExpenses,
} from '@/data/mockExpenses';

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

function pickExpenseReceipt(expenseId: string, reattach = false) {
  if (typeof document === 'undefined' || typeof URL === 'undefined') {
    if (!reattach) {
      attachExpenseReceipt(expenseId);
    }
    return;
  }

  const input = document.createElement('input');
  input.type = 'file';
  input.onchange = () => {
    const file = input.files?.[0];
    if (!file) return;

    const receiptInput = {
      name: file.name,
      type: file.type || 'application/octet-stream',
      size: file.size,
      objectUrl: URL.createObjectURL(file),
    };

    if (reattach) {
      reattachExpenseReceipt(expenseId, receiptInput);
    } else {
      attachExpenseReceipt(expenseId, receiptInput);
    }
  };
  input.click();
}

function viewReceipt(receipt: ExpenseReceipt) {
  if (typeof window === 'undefined' || !receipt.objectUrl) {
    return;
  }

  window.open(receipt.objectUrl, '_blank', 'noopener,noreferrer');
}

export default function ExpensesScreen() {
  const expenses = useExpenses();
  const totalMonthlyExpenses = calculateTotalMonthlyExpenses(expenses);
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');

  const categories = ['All', 'Fuel', 'Repairs', 'Insurance', 'Permits', 'Tolls', 'Meals', 'Office', 'Software', 'Other'];

  const visibleExpenses = useMemo(() =>
    expenses.filter((exp) => {
      if (categoryFilter !== 'All' && exp.category !== categoryFilter) return false;
      if (!query.trim()) return true;
      const q = query.toLowerCase();
      return (
        exp.vendor.toLowerCase().includes(q) ||
        (exp.category ?? '').toLowerCase().includes(q) ||
        (exp.notes ?? '').toLowerCase().includes(q)
      );
    }), [expenses, query, categoryFilter]
  );

  return (
    <AppShell activeNav="Expenses">
      <View style={styles.pageHeader}>
        <View>
          <Text style={styles.eyebrow}>Expenses</Text>
          <Text style={styles.heading}>Track what it costs to get the work done.</Text>
        </View>

        <Pressable style={styles.addExpenseButton} onPress={() => router.push('/new-expense')}>
          <Text style={styles.addExpenseText}>+ Add Expense</Text>
        </Pressable>
      </View>

      <View style={styles.summaryCard}>
        <Text style={styles.summaryLabel}>Total Monthly Expenses</Text>
        <Text style={styles.summaryValue}>${totalMonthlyExpenses.toLocaleString()}</Text>
      </View>

      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search expenses (vendor, category, notes)"
          placeholderTextColor="#6b6b6b"
          value={query}
          onChangeText={setQuery}
        />

        <View style={styles.filterRow}>
          {categories.map((c) => (
            <Pressable key={c} onPress={() => setCategoryFilter(c)} style={[styles.filterChip, categoryFilter === c && styles.filterChipActive]}>
              <Text style={[styles.filterChipText, categoryFilter === c && styles.filterChipTextActive]}>{c}</Text>
            </Pressable>
          ))}
        </View>
      </View>

      <View style={styles.expenseCard}>
        <View style={styles.tableHeader}>
          <Text style={[styles.tableHeaderText, styles.dateColumn]}>Date</Text>
          <Text style={[styles.tableHeaderText, styles.vendorColumn]}>Vendor</Text>
          <Text style={[styles.tableHeaderText, styles.categoryColumn]}>Category</Text>
          <Text style={[styles.tableHeaderText, styles.amountColumn]}>Amount</Text>
          <Text style={[styles.tableHeaderText, styles.notesColumn]}>Notes</Text>
          <Text style={[styles.tableHeaderText, styles.actionColumn]}>Action</Text>
        </View>

        <View style={styles.expenseList}>
          {visibleExpenses.map((expense, index) => (
            <View key={`${expense.date}-${expense.vendor}-${index}`} style={styles.expenseItem}>
              <View style={styles.expenseRow}>
                <Text style={[styles.expenseMeta, styles.dateColumn]}>{expense.date}</Text>
                <Text style={[styles.expenseText, styles.vendorColumn]}>{expense.vendor}</Text>
                <View style={styles.categoryColumn}>
                  <View style={styles.categoryPill}>
                    <Text style={styles.categoryText}>{expense.category}</Text>
                  </View>
                </View>
                <Text style={[styles.expenseAmount, styles.amountColumn]}>${expense.amount}</Text>
                <Text style={[styles.expenseMeta, styles.notesColumn]}>{expense.notes}</Text>
                <Pressable style={styles.editButton} onPress={() => router.push(`/new-expense?id=${encodeURIComponent(expense.id ?? '')}`)}>
                  <Text style={styles.editButtonText}>Edit</Text>
                </Pressable>
              </View>

              <View style={styles.receiptSection}>
                <View style={styles.receiptCopy}>
                  <Text style={styles.receiptTitle}>Receipt</Text>
                  <Text style={styles.receiptMeta}>Local file preview is temporary until cloud storage is added.</Text>
                  <Text style={styles.receiptMeta}>
                    {expense.receipt ? expense.receipt.name : 'No receipt attached yet. Use Attach Receipt to save receipt metadata locally.'}
                  </Text>
                  {expense.receipt && (
                    <Text style={styles.receiptMeta}>
                      {expense.receipt.type} • {formatFileSize(expense.receipt.size)} • Uploaded {formatUploadDate(expense.receipt.dateAdded)}
                    </Text>
                  )}
                  {expense.receipt && !expense.receipt.objectUrl && (
                    <Text style={styles.receiptNeedsText}>Preview unavailable after browser refresh.</Text>
                  )}
                </View>

                <View style={styles.receiptActions}>
                  {expense.receipt && (
                    <>
                      {expense.receipt.objectUrl ? (
                        <Pressable
                          style={styles.receiptActionButton}
                          onPress={() => expense.receipt && viewReceipt(expense.receipt)}
                        >
                          <Text style={styles.receiptActionButtonText}>View</Text>
                        </Pressable>
                      ) : (
                        <Pressable
                          disabled={!expense.id}
                          style={styles.receiptActionButton}
                          onPress={() => expense.id && pickExpenseReceipt(expense.id, true)}
                        >
                          <Text style={styles.receiptActionButtonText}>Upload Again</Text>
                        </Pressable>
                      )}

                      <Pressable
                        disabled={!expense.id}
                        style={styles.receiptActionButton}
                        onPress={() => expense.id && deleteExpenseReceipt(expense.id)}
                      >
                        <Text style={styles.receiptActionButtonText}>Delete</Text>
                      </Pressable>
                    </>
                  )}

                  <Pressable
                    disabled={!expense.id}
                    style={styles.attachReceiptButton}
                    onPress={() => expense.id && pickExpenseReceipt(expense.id)}
                  >
                    <Text style={styles.attachReceiptButtonText}>Attach Receipt</Text>
                  </Pressable>
                </View>
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
  addExpenseButton: {
    backgroundColor: '#f97316',
    borderRadius: 16,
    paddingHorizontal: 22,
    paddingVertical: 14,
    shadowColor: '#f97316',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.2,
    shadowRadius: 24,
  },
  addExpenseText: {
    color: '#111111',
    fontSize: 16,
    fontWeight: '900',
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
  expenseCard: {
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
  expenseList: {
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
  expenseItem: {
    gap: 10,
  },
  expenseRow: {
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
  vendorColumn: {
    flex: 1.7,
  },
  categoryColumn: {
    flex: 1,
  },
  amountColumn: {
    flex: 0.8,
  },
  notesColumn: {
    flex: 1.6,
  },
  actionColumn: {
    flex: 0.8,
  },
  editButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#252525',
    borderColor: '#343434',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  editButtonText: {
    color: '#d4d4d4',
    fontSize: 13,
    fontWeight: '900',
  },
  expenseText: {
    color: '#f5f5f5',
    fontSize: 15,
    fontWeight: '800',
  },
  expenseMeta: {
    color: '#a3a3a3',
    fontSize: 15,
    fontWeight: '600',
  },
  expenseAmount: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '900',
  },
  categoryPill: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(249, 115, 22, 0.12)',
    borderColor: 'rgba(249, 115, 22, 0.42)',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  categoryText: {
    color: '#f97316',
    fontSize: 13,
    fontWeight: '900',
  },
  receiptSection: {
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
  receiptTitle: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '900',
  },
  receiptCopy: {
    flex: 1,
    gap: 2,
  },
  receiptMeta: {
    color: '#a3a3a3',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 4,
  },
  receiptNeedsText: {
    color: '#f97316',
    fontSize: 12,
    fontWeight: '900',
    marginTop: 4,
  },
  attachReceiptButton: {
    backgroundColor: 'rgba(249, 115, 22, 0.12)',
    borderColor: 'rgba(249, 115, 22, 0.36)',
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  attachReceiptButtonText: {
    color: '#fdba74',
    fontSize: 13,
    fontWeight: '900',
  },
  receiptActions: {
    alignItems: 'center',
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'flex-end',
  },
  receiptActionButton: {
    backgroundColor: '#252525',
    borderColor: '#343434',
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  receiptActionButtonText: {
    color: '#d4d4d4',
    fontSize: 12,
    fontWeight: '900',
  },
});
