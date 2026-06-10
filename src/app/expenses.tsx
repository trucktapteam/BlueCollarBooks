import { router } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppShell } from '@/components/AppShell';
import { calculateTotalMonthlyExpenses, useExpenses } from '@/data/mockExpenses';

export default function ExpensesScreen() {
  const expenses = useExpenses();
  const totalMonthlyExpenses = calculateTotalMonthlyExpenses(expenses);

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

      <View style={styles.expenseCard}>
        <View style={styles.tableHeader}>
          <Text style={[styles.tableHeaderText, styles.dateColumn]}>Date</Text>
          <Text style={[styles.tableHeaderText, styles.vendorColumn]}>Vendor</Text>
          <Text style={[styles.tableHeaderText, styles.categoryColumn]}>Category</Text>
          <Text style={[styles.tableHeaderText, styles.amountColumn]}>Amount</Text>
          <Text style={[styles.tableHeaderText, styles.notesColumn]}>Notes</Text>
        </View>

        <View style={styles.expenseList}>
          {expenses.map((expense, index) => (
            <View key={`${expense.date}-${expense.vendor}-${index}`} style={styles.expenseRow}>
              <Text style={[styles.expenseMeta, styles.dateColumn]}>{expense.date}</Text>
              <Text style={[styles.expenseText, styles.vendorColumn]}>{expense.vendor}</Text>
              <View style={styles.categoryColumn}>
                <View style={styles.categoryPill}>
                  <Text style={styles.categoryText}>{expense.category}</Text>
                </View>
              </View>
              <Text style={[styles.expenseAmount, styles.amountColumn]}>${expense.amount}</Text>
              <Text style={[styles.expenseMeta, styles.notesColumn]}>{expense.notes}</Text>
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
});
