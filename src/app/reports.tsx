import Head from 'expo-router/head';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { AppShell } from '@/components/AppShell';
import { useBusinessProfile } from '@/data/mockBusiness';
import { useExpenses } from '@/data/mockExpenses';
import {
  type AgingLine,
  type ReportLine,
  fetchArAging,
  fetchBalanceSheet,
  fetchProfitAndLoss,
  yearBounds,
} from '@/data/ledgerReports';
import {
  calculateInvoiceBalance,
  formatInvoiceAmount,
  type Invoice,
  useInvoices,
} from '@/data/mockInvoices';
import { formatDueDateDisplay } from '@/utils/date';
import { downloadBlob } from '@/utils/downloadFile';

// CSV cells hold a plain dollar number (not cents, and not a "$"-prefixed
// string) so a spreadsheet can sum the column directly.
function centsToCsvDollars(cents: number) {
  return Math.round(cents) / 100;
}

function escapeCsvValue(value: string | number | undefined) {
  const stringValue = value === undefined ? '' : String(value);
  return `"${stringValue.replace(/"/g, '""')}"`;
}

function buildCsv(rows: Array<Array<string | number | undefined>>) {
  return rows.map((row) => row.map(escapeCsvValue).join(',')).join('\n');
}

function downloadCsv(filename: string, rows: Array<Array<string | number | undefined>>) {
  const blob = new Blob([buildCsv(rows)], { type: 'text/csv;charset=utf-8;' });
  downloadBlob(filename, blob);
}

function buildInvoiceDueDate(invoice: Invoice) {
  return formatDueDateDisplay(invoice.invoiceDate, invoice.terms);
}

// Plain-language names for the few books accounts that are not business categories.
const FRIENDLY_NAMES: Record<string, string> = {
  'Opening Balance Equity': 'Starting balances',
  'Owner Contributions': 'Money you put in',
  'Owner Draws': 'Money you took out',
  'Profit to date': 'Profit so far',
};

function friendly(name: string) {
  return FRIENDLY_NAMES[name] ?? name;
}

function sumLines(lines: ReportLine[], section: string) {
  return lines.filter((line) => line.section === section).reduce((total, line) => total + line.amountCents, 0);
}

export default function ReportsScreen() {
  const { width } = useWindowDimensions();
  const isCompact = width < 760;
  const profile = useBusinessProfile();
  const invoices = useInvoices();
  const expenses = useExpenses();
  const bounds = yearBounds();
  const currentYear = Number(bounds.start.slice(0, 4));

  // Cash basis (money actually received) is the default; accrual (money invoiced) is one tap away.
  const [basis, setBasis] = useState<'cash' | 'accrual'>('cash');
  const [profitLines, setProfitLines] = useState<ReportLine[] | null>(null);
  const [balanceLines, setBalanceLines] = useState<ReportLine[] | null>(null);
  const [agingLines, setAgingLines] = useState<AgingLine[] | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoadFailed(false);
    Promise.all([
      fetchProfitAndLoss(bounds.start, bounds.end, basis),
      fetchBalanceSheet(bounds.today),
      fetchArAging(bounds.today),
    ]).then(([profit, balance, aging]) => {
      if (cancelled) return;
      if (!profit || !balance || !aging) {
        setLoadFailed(true);
        return;
      }
      setProfitLines(profit);
      setBalanceLines(balance);
      setAgingLines(aging);
    });
    return () => {
      cancelled = true;
    };
  }, [basis, invoices, expenses, bounds.start, bounds.end, bounds.today]);

  const incomeLines = (profitLines ?? []).filter((line) => line.section === 'income' || line.section === 'unapplied');
  const expenseLines = (profitLines ?? [])
    .filter((line) => line.section === 'expense')
    .sort((first, second) => second.amountCents - first.amountCents);
  const income = incomeLines.reduce((total, line) => total + line.amountCents, 0);
  const totalExpenses = sumLines(profitLines ?? [], 'expense');
  const netProfit = income - totalExpenses;
  const assets = (balanceLines ?? []).filter((line) => line.section === 'assets');
  const liabilities = (balanceLines ?? []).filter((line) => line.section === 'liabilities');
  const equity = (balanceLines ?? []).filter((line) => line.section === 'equity');
  const owedTotal = (agingLines ?? []).reduce((total, line) => total + line.balanceCents, 0);
  const incomeLabel = basis === 'cash' ? 'Money collected' : 'Money invoiced';

  function exportProfitAndLossCsv() {
    downloadCsv(`profit-and-loss-${basis}-${currentYear}.csv`, [
      ['section', 'label', 'amount'],
      ...incomeLines.map((line) => ['Money In', friendly(line.name), centsToCsvDollars(line.amountCents)]),
      ...expenseLines.map((line) => ['Money Out', line.name, centsToCsvDollars(line.amountCents)]),
      ['Money Out', 'Total money out', centsToCsvDollars(totalExpenses)],
      ['Profit', basis === 'cash' ? 'Money collected minus money out' : 'Money invoiced minus money out', centsToCsvDollars(netProfit)],
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
      <Head>
        <title>Reports | Blue Collar Books</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <View style={styles.pageHeader}>
        <View style={styles.pageHeaderText}>
          <Text style={styles.eyebrow}>Reports</Text>
          <Text style={[styles.heading, isCompact && styles.headingCompact]}>Money Report</Text>
        </View>

        <View style={[styles.exportGrid, isCompact && styles.exportGridCompact]}>
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
        <View style={styles.basisRow}>
          {(['cash', 'accrual'] as const).map((option) => (
            <Pressable
              key={option}
              style={[styles.basisChip, basis === option && styles.basisChipActive]}
              onPress={() => setBasis(option)}
            >
              <Text style={[styles.basisChipText, basis === option && styles.basisChipTextActive]}>
                {option === 'cash' ? 'Count money when it comes in' : 'Count money when I bill it'}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {loadFailed && <Text style={styles.errorText}>Could not load your reports. Pull to refresh or try again.</Text>}

      <View style={styles.reportCard}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>💵 Money In</Text>
          <Text style={styles.sectionTotal}>{formatInvoiceAmount(income)}</Text>
        </View>

        <View style={styles.reportRow}>
          <Text style={styles.reportLabel}>{incomeLabel}</Text>
          <Text style={styles.reportAmount}>
            {formatInvoiceAmount(incomeLines.filter((line) => line.section === 'income').reduce((total, line) => total + line.amountCents, 0))}
          </Text>
        </View>
        {incomeLines
          .filter((line) => line.section === 'unapplied')
          .map((line) => (
            <View key={line.name} style={styles.reportRow}>
              <Text style={styles.reportLabel}>{line.name}</Text>
              <Text style={styles.reportAmount}>{formatInvoiceAmount(line.amountCents)}</Text>
            </View>
          ))}
      </View>

      <View style={styles.reportCard}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>🧾 Money Out By Type</Text>
          <Text style={styles.sectionTotal}>{formatInvoiceAmount(totalExpenses)}</Text>
        </View>

        <View style={styles.reportList}>
          {expenseLines.map((line) => (
            <View key={line.accountId ?? line.name} style={styles.reportRow}>
              <Text style={styles.reportLabel}>{line.name}</Text>
              <Text style={styles.reportAmount}>{formatInvoiceAmount(line.amountCents)}</Text>
            </View>
          ))}
        </View>
      </View>

      <View style={styles.netProfitCard}>
        <View style={styles.pageHeaderText}>
          <Text style={styles.netProfitLabel}>Profit</Text>
          <Text style={styles.netProfitSubtext}>
            {basis === 'cash' ? 'Money collected minus money out' : 'Money invoiced minus money out'} for {currentYear}
          </Text>
        </View>

        <Text style={[styles.netProfitValue, isCompact && styles.netProfitValueCompact]}>
          {formatInvoiceAmount(netProfit)}
        </Text>
      </View>

      <View style={styles.reportCard}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>🏦 What You Have And Owe (today)</Text>
        </View>
        <BalanceGroup title="What you have" lines={assets} />
        <BalanceGroup title="What you owe" lines={liabilities} />
        <BalanceGroup title="What's yours" lines={equity} />
      </View>

      <View style={styles.reportCard}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>💰 Who Owes You</Text>
          <Text style={styles.sectionTotal}>{formatInvoiceAmount(owedTotal)}</Text>
        </View>
        <View style={styles.reportList}>
          {(agingLines ?? []).map((line) => (
            <View key={line.invoiceId} style={styles.reportRow}>
              <Text style={styles.reportLabel}>
                #{line.invoiceNumber} {line.customer} · {line.bucket === 'Current' ? 'Not due yet' : `${line.daysPastDue ?? 0} days late`}
              </Text>
              <Text style={styles.reportAmount}>{formatInvoiceAmount(line.balanceCents)}</Text>
            </View>
          ))}
          {agingLines !== null && agingLines.length === 0 && <Text style={styles.reportLabel}>Nobody owes you right now.</Text>}
        </View>
      </View>
    </AppShell>
  );

  function BalanceGroup({ title, lines }: { title: string; lines: ReportLine[] }) {
    if (lines.length === 0) return null;
    return (
      <View style={styles.reportList}>
        <Text style={styles.groupTitle}>{title}</Text>
        {lines.map((line) => (
          <View key={line.accountId ?? line.name} style={styles.reportRow}>
            <Text style={styles.reportLabel}>{friendly(line.name)}</Text>
            <Text style={styles.reportAmount}>{formatInvoiceAmount(line.amountCents)}</Text>
          </View>
        ))}
      </View>
    );
  }
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
  exportGridCompact: {
    justifyContent: 'flex-start',
    maxWidth: '100%',
    width: '100%',
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
  basisRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 16,
  },
  basisChip: {
    backgroundColor: '#252525',
    borderColor: '#383838',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  basisChipActive: {
    backgroundColor: 'rgba(255, 122, 0, 0.14)',
    borderColor: 'rgba(255, 122, 0, 0.45)',
  },
  basisChipText: {
    color: '#d4d4d4',
    fontSize: 14,
    fontWeight: '800',
  },
  basisChipTextActive: {
    color: '#ff7a00',
  },
  errorText: {
    color: '#ff6b6b',
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 16,
  },
  groupTitle: {
    color: '#a3a3a3',
    fontSize: 14,
    fontWeight: '900',
    marginTop: 8,
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
    flexWrap: 'wrap',
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
  netProfitValueCompact: {
    fontSize: 32,
  },
});
