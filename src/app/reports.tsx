import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppShell } from '@/components/AppShell';
import { calculateTotalMonthlyExpenses, type Expense, useExpenses } from '@/data/mockExpenses';
import { calculateInvoiceTotal, formatInvoiceAmount, useInvoices } from '@/data/mockInvoices';

type ExpenseCategoryTotal = {
  category: string;
  amount: number;
};

function groupExpensesByCategory(expenses: Expense[]): ExpenseCategoryTotal[] {
  const categoryTotals = expenses.reduce<Record<string, number>>((totals, expense) => {
    totals[expense.category] = (totals[expense.category] ?? 0) + expense.amount;
    return totals;
  }, {});

  return Object.entries(categoryTotals)
    .map(([category, amount]) => ({ category, amount }))
    .sort((first, second) => second.amount - first.amount);
}

export default function ReportsScreen() {
  const invoices = useInvoices();
  const expenses = useExpenses();
  const currentYear = new Date().getFullYear();
  const income = calculateInvoiceTotal(invoices);
  const totalExpenses = calculateTotalMonthlyExpenses(expenses);
  const netProfit = income - totalExpenses;
  const expensesByCategory = groupExpensesByCategory(expenses);

  return (
    <AppShell activeNav="Reports">
      <View style={styles.pageHeader}>
        <View>
          <Text style={styles.eyebrow}>Reports</Text>
          <Text style={styles.heading}>Profit & Loss</Text>
        </View>

        <Pressable style={styles.exportButton}>
          <Text style={styles.exportButtonText}>Export P&L PDF</Text>
        </Pressable>
      </View>

      <View style={styles.heroCard}>
        <Text style={styles.heroLabel}>Current Year P&L</Text>
        <Text style={styles.heroValue}>{currentYear}</Text>
        <Text style={styles.heroCopy}>For the tax guy, without the shoebox math.</Text>
      </View>

      <View style={styles.reportCard}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Income</Text>
          <Text style={styles.sectionTotal}>{formatInvoiceAmount(income)}</Text>
        </View>

        <View style={styles.reportRow}>
          <Text style={styles.reportLabel}>Invoice income</Text>
          <Text style={styles.reportAmount}>{formatInvoiceAmount(income)}</Text>
        </View>
      </View>

      <View style={styles.reportCard}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Expenses by category</Text>
          <Text style={styles.sectionTotal}>{formatInvoiceAmount(totalExpenses)}</Text>
        </View>

        <View style={styles.reportList}>
          {expensesByCategory.map((expense) => (
            <View key={expense.category} style={styles.reportRow}>
              <Text style={styles.reportLabel}>{expense.category}</Text>
              <Text style={styles.reportAmount}>{formatInvoiceAmount(expense.amount)}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.netProfitCard}>
        <View>
          <Text style={styles.netProfitLabel}>Net Profit</Text>
          <Text style={styles.netProfitSubtext}>Income minus expenses for {currentYear}</Text>
        </View>

        <Text style={styles.netProfitValue}>{formatInvoiceAmount(netProfit)}</Text>
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
  exportButton: {
    backgroundColor: '#f97316',
    borderRadius: 16,
    paddingHorizontal: 22,
    paddingVertical: 14,
    shadowColor: '#f97316',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.2,
    shadowRadius: 24,
  },
  exportButtonText: {
    color: '#111111',
    fontSize: 16,
    fontWeight: '900',
  },
  heroCard: {
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
  heroLabel: {
    color: '#a3a3a3',
    fontSize: 16,
    fontWeight: '800',
    marginBottom: 8,
  },
  heroValue: {
    color: '#ffffff',
    fontSize: 46,
    fontWeight: '900',
  },
  heroCopy: {
    color: '#f97316',
    fontSize: 16,
    fontWeight: '800',
    marginTop: 8,
  },
  reportCard: {
    backgroundColor: '#1e1e1e',
    borderColor: '#323232',
    borderRadius: 22,
    borderWidth: 1,
    marginBottom: 24,
    padding: 28,
  },
  sectionHeader: {
    alignItems: 'center',
    borderBottomColor: '#323232',
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
    paddingBottom: 16,
  },
  sectionTitle: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '900',
  },
  sectionTotal: {
    color: '#f97316',
    fontSize: 20,
    fontWeight: '900',
  },
  reportList: {
    gap: 12,
  },
  reportRow: {
    alignItems: 'center',
    backgroundColor: '#252525',
    borderColor: '#353535',
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 16,
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  reportLabel: {
    color: '#f5f5f5',
    fontSize: 16,
    fontWeight: '800',
  },
  reportAmount: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '900',
  },
  netProfitCard: {
    alignItems: 'center',
    backgroundColor: '#202020',
    borderColor: 'rgba(249, 115, 22, 0.42)',
    borderRadius: 22,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 24,
    justifyContent: 'space-between',
    padding: 28,
  },
  netProfitLabel: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: '900',
  },
  netProfitSubtext: {
    color: '#a3a3a3',
    fontSize: 14,
    fontWeight: '700',
    marginTop: 5,
  },
  netProfitValue: {
    color: '#ffffff',
    fontSize: 42,
    fontWeight: '900',
  },
});
