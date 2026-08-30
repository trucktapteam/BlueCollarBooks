import { router, useLocalSearchParams } from 'expo-router';
import Head from 'expo-router/head';
import { useEffect, useState } from 'react';
import type { KeyboardTypeOptions } from 'react-native';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { AppShell } from '@/components/AppShell';
import { addCategory, useCategories } from '@/data/mockCategories';
import { expenseDraft, saveExpense, useExpenses } from '@/data/mockExpenses';
import { generateId } from '@/utils/id';
import { formatMoneyCents, parseMoneyInputToCents } from '@/utils/money';
import { selectTextOnFocus } from '@/utils/selectOnFocus';
import { formatDateDisplay, normalizeDateToISO, toISODateString } from '@/utils/date';

export default function NewExpenseScreen() {
  const searchParams = useLocalSearchParams();
  const expenses = useExpenses();
  const categories = useCategories();
  const [originalId, setOriginalId] = useState<string | undefined>(undefined);
  const [date, setDate] = useState(() => formatDateDisplay(toISODateString(new Date())));
  const [vendor, setVendor] = useState(expenseDraft.vendor);
  const [amount, setAmount] = useState(expenseDraft.amount);
  const [category, setCategory] = useState(expenseDraft.category);
  const [notes, setNotes] = useState(expenseDraft.notes);
  const [showSavedToast, setShowSavedToast] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [isAddingCategory, setIsAddingCategory] = useState(false);

  useEffect(() => {
    if (showSavedToast) {
      const timer = setTimeout(() => setShowSavedToast(false), 2000);
      return () => clearTimeout(timer);
    }
  }, [showSavedToast]);

  // Default to the user's first category once their list has loaded - it
  // can't be known synchronously at mount since categories load async from
  // Supabase (see useCategories/bootstrap.ts). Only fills in a blank
  // category, so this never overwrites what an edited expense already has.
  useEffect(() => {
    if (!category && categories.length > 0) {
      setCategory(categories[0].name);
    }
  }, [category, categories]);

  async function handleAddCategory() {
    const name = newCategoryName.trim();
    if (!name) return;
    setIsAddingCategory(true);
    try {
      await addCategory(name);
      setCategory(name);
      setNewCategoryName('');
    } finally {
      setIsAddingCategory(false);
    }
  }

  useEffect(() => {
    const idParam = typeof searchParams.id === 'string' ? searchParams.id : '';

    if (!idParam || originalId) {
      return;
    }

    const foundExpense = expenses.find((expense) => expense.id === idParam);
    if (foundExpense) {
      setOriginalId(foundExpense.id);
      setDate(formatDateDisplay(foundExpense.date));
      setVendor(foundExpense.vendor);
      setAmount(formatMoneyCents(foundExpense.amount));
      setCategory(foundExpense.category);
      setNotes(foundExpense.notes);
    }
  }, [expenses, originalId, searchParams.id]);

  function handleSaveExpense() {
    const expenseId = originalId ?? generateId();
    saveExpense(
      {
        id: expenseId,
        date: normalizeDateToISO(date),
        vendor,
        category,
        amount: parseMoneyInputToCents(amount),
        notes,
      },
      originalId
    );
    // default was save & close; keep that behavior elsewhere
    router.replace('/expenses');
  }

  function handleSave() {
    // Reuse the same id across repeated "Save" clicks on a brand-new
    // expense - otherwise each click would generate a fresh id and create
    // a new duplicate row instead of updating the one just saved.
    const expenseId = originalId ?? generateId();
    saveExpense(
      {
        id: expenseId,
        date: normalizeDateToISO(date),
        vendor,
        category,
        amount: parseMoneyInputToCents(amount),
        notes,
      },
      originalId
    );
    setOriginalId(expenseId);
    setShowSavedToast(true);
  }

  function handleSaveAndClose() {
    const expenseId = originalId ?? generateId();
    saveExpense(
      {
        id: expenseId,
        date: normalizeDateToISO(date),
        vendor,
        category,
        amount: parseMoneyInputToCents(amount),
        notes,
      },
      originalId
    );
    router.replace('/expenses');
  }

  function handleCancel() {
    router.push('/expenses');
  }

  return (
    <AppShell activeNav="Expenses">
      <Head>
        <title>New Expense | Blue Collar Books</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      {showSavedToast && (
        <View style={styles.toast}>
          <Text style={styles.toastText}>Saved</Text>
        </View>
      )}
      <View style={styles.pageHeader}>
        <View>
          <Text style={styles.eyebrow}>Expenses</Text>
          <Text style={styles.heading}>{originalId ? 'Edit Money Out' : 'Add Money Out'}</Text>
        </View>

        <Pressable style={styles.cancelTopButton} onPress={() => router.push('/expenses')}>
          <Text style={styles.cancelTopButtonText}>Back to Expenses</Text>
        </Pressable>
      </View>

      <View style={styles.formCard}>
        <View style={styles.formGrid}>
          <Field label="Date" value={date} onChangeText={setDate} />
          <Field label="Vendor" value={vendor} onChangeText={setVendor} />
          <Field label="Amount" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" selectOnFocus />
        </View>

        <View style={styles.categorySection}>
          <Text style={styles.fieldLabel}>Type</Text>
          <View style={styles.categoryGrid}>
            {categories.map(({ id, name: categoryName }) => {
              const isActive = categoryName === category;

              return (
                <Pressable
                  key={id}
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

          <View style={styles.addCategoryRow}>
            <TextInput
              style={styles.addCategoryInput}
              placeholder="Add a category (e.g. Equipment)"
              placeholderTextColor="#6b6b6b"
              value={newCategoryName}
              onChangeText={setNewCategoryName}
              onSubmitEditing={handleAddCategory}
            />
            <Pressable
              style={styles.addCategoryButton}
              onPress={handleAddCategory}
              disabled={isAddingCategory || !newCategoryName.trim()}
            >
              <Text style={styles.addCategoryButtonText}>{isAddingCategory ? 'Adding…' : 'Add'}</Text>
            </Pressable>
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

        <View style={[styles.bottomActionBar, Platform.OS === 'web' && styles.bottomActionBarSticky]}>
          <View>
            <Text style={styles.actionLabel}>Money out ready.</Text>
            <Text style={styles.actionSubtext}>Reflected in your dashboard and reports.</Text>
          </View>

          <View style={styles.actionRow}>
            <Pressable style={styles.secondaryButton} onPress={handleCancel}>
              <Text style={styles.secondaryButtonText}>Cancel</Text>
            </Pressable>

            <Pressable style={styles.primaryButton} onPress={handleSave}>
              <Text style={styles.primaryButtonText}>Save</Text>
            </Pressable>

            <Pressable style={styles.secondaryButton} onPress={handleSaveAndClose}>
              <Text style={styles.secondaryButtonText}>Save & Go Back</Text>
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
  selectOnFocus = false,
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  multiline?: boolean;
  keyboardType?: KeyboardTypeOptions;
  selectOnFocus?: boolean;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        editable
        keyboardType={keyboardType}
        multiline={multiline}
        onChangeText={onChangeText}
        onFocus={selectOnFocus ? selectTextOnFocus : undefined}
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
    backgroundColor: 'rgba(255, 122, 0, 0.14)',
    borderColor: 'rgba(255, 122, 0, 0.45)',
  },
  categoryChipText: {
    color: '#d4d4d4',
    fontSize: 14,
    fontWeight: '800',
  },
  categoryChipTextActive: {
    color: '#ff7a00',
  },
  addCategoryRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 14,
  },
  addCategoryInput: {
    backgroundColor: '#252525',
    borderColor: '#383838',
    borderRadius: 12,
    borderWidth: 1,
    color: '#ffffff',
    flex: 1,
    fontSize: 14,
    fontWeight: '700',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  addCategoryButton: {
    backgroundColor: '#252525',
    borderColor: 'rgba(255, 122, 0, 0.45)',
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  addCategoryButtonText: {
    color: '#ff7a00',
    fontSize: 13,
    fontWeight: '900',
  },
  notesSection: {
    marginTop: 18,
  },
  receiptCard: {
    alignItems: 'center',
    backgroundColor: 'rgba(255, 122, 0, 0.08)',
    borderColor: 'rgba(255, 122, 0, 0.32)',
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
    backgroundColor: 'rgba(255, 122, 0, 0.16)',
    borderRadius: 16,
    height: 46,
    justifyContent: 'center',
    width: 46,
  },
  receiptIconText: {
    color: '#ff7a00',
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
  bottomActionBarSticky: {
    position: 'fixed',
    left: 48,
    right: 48,
    bottom: 24,
    zIndex: 60,
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
    backgroundColor: '#ff7a00',
    borderRadius: 16,
    paddingHorizontal: 22,
    paddingVertical: 14,
    shadowColor: '#ff7a00',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.2,
    shadowRadius: 24,
  },
  primaryButtonText: {
    color: '#111111',
    fontSize: 16,
    fontWeight: '900',
  },
  toast: {
    position: 'fixed',
    top: 20,
    left: '50%',
    marginLeft: -60,
    backgroundColor: '#43a047',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    zIndex: 100,
  },
  toastText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
});
