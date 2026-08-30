import { router } from 'expo-router';
import Head from 'expo-router/head';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { AppShell } from '@/components/AppShell';
import { useSession } from '@/data/authStore';
import { expenseCategories } from '@/data/mockExpenses';
import {
  categorizeTransaction,
  excludeTransaction,
  getTransactionsNeedingReview,
  loadPlaidTransactions,
  type PlaidTransaction,
  usePlaidTransactions,
} from '@/data/mockPlaidTransactions';
import { formatMoneyCents } from '@/utils/money';
import { formatDateDisplay } from '@/utils/date';
import { suggestExpenseCategory } from '@/utils/suggestCategory';

export default function TransactionsScreen() {
  const session = useSession();
  const transactions = usePlaidTransactions();
  const needsReview = getTransactionsNeedingReview(transactions).sort((a, b) => (a.date < b.date ? 1 : -1));
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState('');

  async function handleSync() {
    const accessToken = session?.access_token;
    if (!accessToken) return;

    setSyncError('');
    setIsSyncing(true);
    try {
      const response = await fetch('/api/plaid-transactions-sync', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error ?? 'Could not sync transactions.');
      }
      if (session?.user.id) {
        await loadPlaidTransactions(session.user.id);
      }
    } catch (error) {
      setSyncError(error instanceof Error ? error.message : 'Something went wrong. Try again.');
    } finally {
      setIsSyncing(false);
    }
  }

  return (
    <AppShell activeNav="Expenses">
      <Head>
        <title>Categorize Transactions | Blue Collar Books</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>

      <View style={styles.pageHeader}>
        <View>
          <Text style={styles.eyebrow}>Bank Feed</Text>
          <Text style={styles.heading}>Categorize what came out of the bank.</Text>
          <Text style={styles.subheading}>
            Each one becomes a real expense once you pick a type. Not a business expense? Exclude it instead.
          </Text>
        </View>

        <View style={styles.headerActions}>
          <Pressable style={styles.syncButton} onPress={handleSync} disabled={isSyncing}>
            <Text style={styles.syncButtonText}>{isSyncing ? 'Syncing…' : 'Sync Now'}</Text>
          </Pressable>
          <Pressable style={styles.backButton} onPress={() => router.push('/expenses')}>
            <Text style={styles.backButtonText}>Back to Expenses</Text>
          </Pressable>
        </View>
      </View>

      {!!syncError && <Text style={styles.syncErrorText}>{syncError}</Text>}

      {needsReview.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>Nothing to categorize.</Text>
          <Text style={styles.emptyText}>
            {transactions.length === 0
              ? "Once your bank is connected, tap Sync Now to pull in recent transactions."
              : "You're caught up - every bank transaction has been categorized or excluded."}
          </Text>
        </View>
      ) : (
        <View style={styles.list}>
          {needsReview.map((transaction) => (
            <TransactionRow key={transaction.id} transaction={transaction} />
          ))}
        </View>
      )}
    </AppShell>
  );
}

function TransactionRow({ transaction }: { transaction: PlaidTransaction }) {
  const [selectedCategory, setSelectedCategory] = useState(() =>
    suggestExpenseCategory([transaction.plaidCategory])
  );
  const [isSaving, setIsSaving] = useState(false);
  const [isExcluding, setIsExcluding] = useState(false);
  const [error, setError] = useState('');

  async function handleCategorize() {
    setError('');
    setIsSaving(true);
    try {
      await categorizeTransaction(transaction, selectedCategory);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save this expense.');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleExclude() {
    setError('');
    setIsExcluding(true);
    try {
      await excludeTransaction(transaction.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not exclude this transaction.');
    } finally {
      setIsExcluding(false);
    }
  }

  const isBusy = isSaving || isExcluding;

  return (
    <View style={styles.row}>
      <View style={styles.rowTop}>
        <View style={styles.rowPrimary}>
          <Text style={styles.rowVendor}>{transaction.merchantName || transaction.name}</Text>
          <Text style={styles.rowMeta}>
            {formatDateDisplay(transaction.date)}
            {transaction.pending ? ' • Pending' : ''}
          </Text>
        </View>
        <Text style={styles.rowAmount}>{formatMoneyCents(transaction.amount)}</Text>
      </View>

      <View style={styles.categoryGrid}>
        {expenseCategories.map((categoryName) => {
          const isActive = categoryName === selectedCategory;
          return (
            <Pressable
              key={categoryName}
              disabled={isBusy}
              style={[styles.categoryChip, isActive && styles.categoryChipActive]}
              onPress={() => setSelectedCategory(categoryName)}
            >
              <Text style={[styles.categoryChipText, isActive && styles.categoryChipTextActive]}>{categoryName}</Text>
            </Pressable>
          );
        })}
      </View>

      {!!error && <Text style={styles.rowErrorText}>{error}</Text>}

      <View style={styles.rowActions}>
        <Pressable style={styles.excludeButton} onPress={handleExclude} disabled={isBusy}>
          <Text style={styles.excludeButtonText}>{isExcluding ? 'Excluding…' : 'Not a Business Expense'}</Text>
        </Pressable>
        <Pressable style={styles.categorizeButton} onPress={handleCategorize} disabled={isBusy}>
          <Text style={styles.categorizeButtonText}>
            {isSaving ? 'Saving…' : `Save as ${selectedCategory}`}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pageHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    flexWrap: 'wrap',
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
  subheading: {
    color: '#a3a3a3',
    fontSize: 15,
    fontWeight: '600',
    marginTop: 8,
    maxWidth: 520,
  },
  headerActions: {
    flexDirection: 'row',
    gap: 12,
  },
  syncButton: {
    backgroundColor: '#ff7a00',
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  syncButtonText: {
    color: '#111111',
    fontSize: 15,
    fontWeight: '900',
  },
  backButton: {
    backgroundColor: '#252525',
    borderColor: '#343434',
    borderRadius: 16,
    borderWidth: 1,
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  backButtonText: {
    color: '#d4d4d4',
    fontSize: 15,
    fontWeight: '800',
  },
  syncErrorText: {
    color: '#ff6b6b',
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 16,
  },
  emptyState: {
    backgroundColor: '#1e1e1e',
    borderColor: '#323232',
    borderRadius: 22,
    borderWidth: 1,
    padding: 40,
  },
  emptyTitle: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '900',
    marginBottom: 8,
  },
  emptyText: {
    color: '#a3a3a3',
    fontSize: 15,
    fontWeight: '600',
    maxWidth: 460,
  },
  list: {
    gap: 14,
  },
  row: {
    backgroundColor: '#1e1e1e',
    borderColor: '#323232',
    borderRadius: 20,
    borderWidth: 1,
    gap: 14,
    padding: 22,
  },
  rowTop: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 16,
    justifyContent: 'space-between',
  },
  rowPrimary: {
    flex: 1,
    gap: 4,
  },
  rowVendor: {
    color: '#ffffff',
    fontSize: 17,
    fontWeight: '900',
  },
  rowMeta: {
    color: '#a3a3a3',
    fontSize: 13,
    fontWeight: '700',
  },
  rowAmount: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: '900',
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  categoryChip: {
    backgroundColor: '#252525',
    borderColor: '#383838',
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  categoryChipActive: {
    backgroundColor: 'rgba(255, 122, 0, 0.14)',
    borderColor: 'rgba(255, 122, 0, 0.45)',
  },
  categoryChipText: {
    color: '#d4d4d4',
    fontSize: 13,
    fontWeight: '800',
  },
  categoryChipTextActive: {
    color: '#ff7a00',
  },
  rowErrorText: {
    color: '#ff6b6b',
    fontSize: 13,
    fontWeight: '700',
  },
  rowActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    justifyContent: 'flex-end',
  },
  excludeButton: {
    backgroundColor: '#252525',
    borderColor: '#343434',
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  excludeButtonText: {
    color: '#d4d4d4',
    fontSize: 13,
    fontWeight: '900',
  },
  categorizeButton: {
    backgroundColor: '#ff7a00',
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  categorizeButtonText: {
    color: '#111111',
    fontSize: 13,
    fontWeight: '900',
  },
});
