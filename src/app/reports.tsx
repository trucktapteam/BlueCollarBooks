import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { AppShell } from '@/components/AppShell';
import { useBusinessProfile } from '@/data/mockBusiness';
import { type Expense, useExpenses } from '@/data/mockExpenses';
import {
  calculateInvoiceBalance,
  calculateInvoiceTotal,
  formatInvoiceAmount,
  isSameYear,
  type Invoice,
  useInvoices,
} from '@/data/mockInvoices';
import { formatDueDateDisplay } from '@/utils/date';

// CSV cells hold a plain dollar number (not cents, and not a "$"-prefixed
// string) so a spreadsheet can sum the column directly.
function centsToCsvDollars(cents: number) {
  return Math.round(cents) / 100;
}

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

function escapeCsvValue(value: string | number | undefined) {
  const stringValue = value === undefined ? '' : String(value);
  return `"${stringValue.replace(/"/g, '""')}"`;
}

function buildCsv(rows: Array<Array<string | number | undefined>>) {
  return rows.map((row) => row.map(escapeCsvValue).join(',')).join('\n');
}

function downloadCsv(filename: string, rows: Array<Array<string | number | undefined>>) {
  if (Platform.OS !== 'web' || typeof document === 'undefined') {
    return;
  }

  const blob = new Blob([buildCsv(rows)], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function buildInvoiceDueDate(invoice: Invoice) {
  return formatDueDateDisplay(invoice.invoiceDate, invoice.terms);
}

export default function ReportsScreen() {
  const profile = useBusinessProfile();
  const invoices = useInvoices();
  const expenses = useExpenses();
  const now = new Date();
  const currentYear = now.getFullYear();
  const invoicesThisYear = invoices.filter((invoice) => isSameYear(invoice.invoiceDate, now));
  const expensesThisYear = expenses.filter((expense) => isSameYear(expense.date, now));
  const income = calculateInvoiceTotal(invoicesThisYear);
  const totalExpenses = expensesThisYear.reduce((total, expense) => total + expense.amount, 0);
  const netProfit = income - totalExpenses;
  const expensesByCategory = groupExpensesByCategory(expensesThisYear);

  function exportProfitAndLossCsv() {
    downloadCsv(`profit-and-loss-${currentYear}.csv`, [
      ['section', 'label', 'amount'],
      ['Money In', 'Invoice money', centsToCsvDollars(income)],
      ...expensesByCategory.map((expense) => ['Money Out', expense.category, centsToCsvDollars(expense.amount)]),
      ['Money Out', 'Total money out', centsToCsvDollars(totalExpenses)],
      ['Profit', 'Money in minus money out', centsToCsvDollars(netProfit)],
    ]);
  }

  function exportExpensesCsv() {
    downloadCsv('expenses.csv', [
      ['date', 'vendor', 'category', 'amount', 'notes'],
      ...expenses.map((expense) => [
        expense.date,
        expense.vendor,
        expense.category,
        centsToCsvDollars(expense.amount),
        expense.notes,
      ]),
    ]);
  }

  function exportInvoicesCsv() {
    downloadCsv('invoices.csv', [
      ['invoice number', 'customer', 'status', 'invoice date', 'due date', 'total', 'balance'],
      ...invoices.map((invoice) => [
        invoice.invoice,
        invoice.customer,
        invoice.status,
        invoice.invoiceDate,
        buildInvoiceDueDate(invoice),
        centsToCsvDollars(invoice.amount),
        centsToCsvDollars(calculateInvoiceBalance(invoice)),
      ]),
    ]);
  }

  function exportPaymentsCsv() {
    const paymentRows = invoices.flatMap((invoice) =>
      (invoice.payments ?? []).map((payment) => [
        payment.date,
        invoice.customer,
        invoice.invoice,
        centsToCsvDollars(payment.amount),
        payment.notes ?? '',
      ])
    );

    downloadCsv('payments.csv', [['date received', 'customer', 'invoice number', 'amount', 'notes'], ...paymentRows]);
  }

  return (
    <AppShell activeNav="Reports">
      <View style={styles.pageHeader}>
        <View>
          <Text style={styles.eyebrow}>Reports</Text>
          <Text style={styles.heading}>Money Report</Text>
        </View>

        <View style={styles.exportGrid}>
          <Pressable style={styles.exportButton} onPress={exportProfitAndLossCsv}>
            <Text style={styles.exportButtonText}>Export Money CSV</Text>
          </Pressable>
          <Pressable style={styles.exportButtonSecondary} onPress={exportExpensesCsv}>
            <Text style={styles.exportButtonSecondaryText}>Export Expenses CSV</Text>
          </Pressable>
          <Pressable style={styles.exportButtonSecondary} onPress={exportInvoicesCsv}>
            <Text style={styles.exportButtonSecondaryText}>Export Invoices CSV</Text>
          </Pressable>
          <Pressable style={styles.exportButtonSecondary} onPress={exportPaymentsCsv}>
            <Text style={styles.exportButtonSecondaryText}>Export Payments CSV</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.heroCard}>
        <Text style={styles.heroLabel}>📈 This Year</Text>
        <Text style={styles.heroValue}>{currentYear}</Text>
        <Text style={styles.heroCopy}>{profile.businessName}</Text>
      </View>

      <View style={styles.reportCard}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>💵 Money In</Text>
          <Text style={styles.sectionTotal}>{formatInvoiceAmount(income)}</Text>
        </View>

        <View style={styles.reportRow}>
          <Text style={styles.reportLabel}>Invoice money</Text>
          <Text style={styles.reportAmount}>{formatInvoiceAmount(income)}</Text>
        </View>
      </View>

      <View style={styles.reportCard}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>🧾 Money Out By Type</Text>
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
          <Text style={styles.netProfitLabel}>Profit</Text>
          <Text style={styles.netProfitSubtext}>Money in minus money out for {currentYear}</Text>
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
  exportButton: {
    backgroundColor: '#ff7a00',
    borderRadius: 16,
    paddingHorizontal: 22,
    paddingVertical: 14,
    shadowColor: '#ff7a00',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.2,
    shadowRadius: 24,
  },
  exportGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'flex-end',
    maxWidth: 560,
  },
  exportButtonText: {
    color: '#111111',
    fontSize: 16,
    fontWeight: '900',
  },
  exportButtonSecondary: {
    backgroundColor: '#252525',
    borderColor: '#343434',
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  exportButtonSecondaryText: {
    color: '#d4d4d4',
    fontSize: 15,
    fontWeight: '900',
  },
  heroCard: {
    backgroundColor: '#202020',
    borderColor: 'rgba(255, 122, 0, 0.42)',
    borderRadius: 22,
    borderWidth: 1,
    marginBottom: 24,
    padding: 28,
    shadowColor: '#ff7a00',
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
    color: '#ff7a00',
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
    color: '#ff7a00',
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
    borderColor: 'rgba(255, 122, 0, 0.42)',
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
