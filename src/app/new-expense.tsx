import { useState } from 'react';
import { router } from 'expo-router';
import type { KeyboardTypeOptions } from 'react-native';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { AppShell } from '@/components/AppShell';
import { addExpense, expenseCategories, expenseDraft } from '@/data/mockExpenses';

function parseAmount(value: string) {
  const amount = Number(value.replace(/[$,]/g, '').trim());
  return Number.isFinite(amount) ? amount : 0;
}

export default function NewExpenseScreen() {
  const [date, setDate] = useState(expenseDraft.date);
  const [vendor, setVendor] = useState(expenseDraft.vendor);
  const [amount, setAmount] = useState(expenseDraft.amount);
  const [category, setCategory] = useState(expenseDraft.category);
  const [notes, setNotes] = useState(expenseDraft.notes);

  function handleSaveExpense() {
    addExpense({
      date,
      vendor,
      category,
      amount: parseAmount(amount),
      notes,
    });
    router.replace('/expenses');
  }

  return (
    <AppShell activeNav="Expenses">
      <View style={styles.pageHeader}>
        <View>
          <Text style={styles.eyebrow}>Expenses</Text>
          <Text style={styles.heading}>Add Expense</Text>
        </View>

        <Pressable style={styles.cancelTopButton} onPress={() => router.push('/expenses')}>
          <Text style={styles.cancelTopButtonText}>Cancel</Text>
        </Pressable>
      </View>

      <View style={styles.formCard}>
        <View style={styles.formGrid}>
          <Field label="Date" value={date} onChangeText={setDate} />
          <Field label="Vendor" value={vendor} onChangeText={setVendor} />
          <Field label="Amount" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
        </View>

        <View style={styles.categorySection}>
          <Text style={styles.fieldLabel}>Category</Text>
          <View style={styles.categoryGrid}>
            {expenseCategories.map((categoryName) => {
              const isActive = categoryName === category;

              return (
                <Pressable
                  key={categoryName}
                  style={[styles.categoryChip, isActive && styles.categoryChipActive]}
                  onPress={() => setCategory(categoryName)}
                >
                  <Text style={[styles.categoryChipText, isActive && styles.categoryChipTextActive]}>
                    {categoryName}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <View style={styles.notesSection}>
          <Field label="Notes" value={notes} onChangeText={setNotes} multiline />
        </View>

        <Pressable style={styles.receiptCard}>
          <View style={styles.receiptIcon}>
            <Text style={styles.receiptIconText}>+</Text>
          </View>

          <View style={styles.receiptCopy}>
            <Text style={styles.receiptTitle}>Attach receipt</Text>
            <Text style={styles.receiptText}>Upload a fuel receipt, repair ticket, or vendor invoice later.</Text>
          </View>
        </Pressable>

        <View style={styles.bottomActionBar}>
          <View>
            <Text style={styles.actionLabel}>Expense draft ready.</Text>
            <Text style={styles.actionSubtext}>Mock-only form. No backend storage yet.</Text>
          </View>

          <View style={styles.actionRow}>
            <Pressable style={styles.secondaryButton} onPress={() => router.push('/expenses')}>
              <Text style={styles.secondaryButtonText}>Cancel</Text>
            </Pressable>

            <Pressable style={styles.primaryButton} onPress={handleSaveExpense}>
              <Text style={styles.primaryButtonText}>Save Expense</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </AppShell>
  );
}

function Field({
  label,
  value,
  onChangeText,
  multiline = false,
  keyboardType = 'default',
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  multiline?: boolean;
  keyboardType?: KeyboardTypeOptions;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        editable
        keyboardType={keyboardType}
        multiline={multiline}
        onChangeText={onChangeText}
        style={[styles.input, multiline && styles.multilineInput]}
        value={value}
      />
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
  cancelTopButton: {
    backgroundColor: '#252525',
    borderColor: '#343434',
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  cancelTopButtonText: {
    color: '#d4d4d4',
    fontSize: 15,
    fontWeight: '800',
  },
  formCard: {
    backgroundColor: '#1e1e1e',
    borderColor: '#323232',
    borderRadius: 22,
    borderWidth: 1,
    padding: 28,
  },
  formGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 18,
  },
  field: {
    flexBasis: '31%',
    flexGrow: 1,
    gap: 8,
  },
  fieldLabel: {
    color: '#a3a3a3',
    fontSize: 14,
    fontWeight: '800',
  },
  input: {
    backgroundColor: '#252525',
    borderColor: '#383838',
    borderRadius: 14,
    borderWidth: 1,
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
    minHeight: 50,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  multilineInput: {
    minHeight: 126,
    textAlignVertical: 'top',
  },
  categorySection: {
    gap: 10,
    marginTop: 18,
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  categoryChip: {
    backgroundColor: '#252525',
    borderColor: '#383838',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  categoryChipActive: {
    backgroundColor: 'rgba(249, 115, 22, 0.14)',
    borderColor: 'rgba(249, 115, 22, 0.45)',
  },
  categoryChipText: {
    color: '#d4d4d4',
    fontSize: 14,
    fontWeight: '800',
  },
  categoryChipTextActive: {
    color: '#f97316',
  },
  notesSection: {
    marginTop: 18,
  },
  receiptCard: {
    alignItems: 'center',
    backgroundColor: 'rgba(249, 115, 22, 0.08)',
    borderColor: 'rgba(249, 115, 22, 0.32)',
    borderRadius: 18,
    borderStyle: 'dashed',
    borderWidth: 1,
    flexDirection: 'row',
    gap: 16,
    marginTop: 24,
    padding: 18,
  },
  receiptIcon: {
    alignItems: 'center',
    backgroundColor: 'rgba(249, 115, 22, 0.16)',
    borderRadius: 16,
    height: 46,
    justifyContent: 'center',
    width: 46,
  },
  receiptIconText: {
    color: '#f97316',
    fontSize: 26,
    fontWeight: '900',
    lineHeight: 28,
  },
  receiptCopy: {
    flex: 1,
    gap: 4,
  },
  receiptTitle: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '900',
  },
  receiptText: {
    color: '#a3a3a3',
    fontSize: 14,
    fontWeight: '600',
  },
  bottomActionBar: {
    alignItems: 'center',
    backgroundColor: '#252525',
    borderColor: '#383838',
    borderRadius: 18,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 18,
    justifyContent: 'space-between',
    marginTop: 24,
    padding: 16,
  },
  actionLabel: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '900',
  },
  actionSubtext: {
    color: '#a3a3a3',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 3,
  },
  actionRow: {
    flexDirection: 'row',
    gap: 14,
    justifyContent: 'flex-end',
  },
  secondaryButton: {
    backgroundColor: '#2b2b2b',
    borderColor: '#3d3d3d',
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 22,
    paddingVertical: 14,
  },
  secondaryButtonText: {
    color: '#d4d4d4',
    fontSize: 16,
    fontWeight: '900',
  },
  primaryButton: {
    backgroundColor: '#f97316',
    borderRadius: 16,
    paddingHorizontal: 22,
    paddingVertical: 14,
    shadowColor: '#f97316',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.2,
    shadowRadius: 24,
  },
  primaryButtonText: {
    color: '#111111',
    fontSize: 16,
    fontWeight: '900',
  },
});
