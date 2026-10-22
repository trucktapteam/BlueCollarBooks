import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  loadReceivablesCheck,
  loadReconciliation,
  type AccountReconciliation,
  type ReceivablesCheck,
  type UnlinkedItem,
} from '@/data/reconciliation';
import { formatDateDisplay } from '@/utils/date';
import { formatMoneyCents } from '@/utils/money';

const SOURCE_LABEL: Record<string, string> = {
  expense: 'Expense',
  payment: 'Customer payment',
  owner_draw: 'Money you took out',
  owner_contribution: 'Money you put in',
  transfer: 'Move between accounts',
  loan: 'Loan',
  loan_payment: 'Loan payment',
  refund: 'Refund',
  equipment: 'Equipment purchase',
};

function signed(cents: number) {
  return `${cents < 0 ? '-' : '+'}${formatMoneyCents(Math.abs(cents))}`;
}

// "Does your bank agree with your books?" Reads only. It explains a difference as
// far as it can and labels the rest unexplained - it never "fixes" the numbers.
export function ReconciliationPanel({ refreshKey }: { refreshKey: unknown }) {
  const [open, setOpen] = useState(false);
  const [accounts, setAccounts] = useState<AccountReconciliation[]>([]);
  const [unlinked, setUnlinked] = useState<UnlinkedItem[]>([]);
  const [receivables, setReceivables] = useState<ReceivablesCheck | null>(null);

  useEffect(() => {
    let live = true;
    loadReconciliation().then((result) => {
      if (!live) return;
      setAccounts(result.accounts);
      setUnlinked(result.unlinked);
    });
    loadReceivablesCheck(new Date().toISOString().slice(0, 10)).then((result) => live && setReceivables(result));
    return () => {
      live = false;
    };
  }, [refreshKey]);

  if (accounts.length === 0) return null;
  const troubled = accounts.filter((a) => a.status !== 'agrees').length;

  return (
    <View style={styles.panel}>
      <Pressable onPress={() => setOpen((v) => !v)} style={styles.header}>
        <Text style={styles.title}>Does your bank agree with your books?</Text>
        <Text style={styles.summary}>
          {troubled === 0 ? 'Yes, for every account' : `${troubled} account${troubled === 1 ? '' : 's'} to look at`} {open ? '▲' : '▼'}
        </Text>
      </Pressable>

      {open && (
        <View style={styles.body}>
          <Text style={styles.note}>
            This only compares. It never changes your books to make them match. Bank balances are as of your last sync.
          </Text>
          {accounts.map((a) => (
            <AccountBlock key={a.accountId} account={a} items={unlinked.filter((u) => u.accountId === a.accountId && u.afterStart)} />
          ))}
          {receivables && receivables.differenceCents !== 0 && (
            <View style={styles.block}>
              <Text style={styles.accountName}>Money owed to you</Text>
              <Text style={styles.warn}>
                Your books say {formatMoneyCents(receivables.ledgerCents)} is owed, but open invoices ({formatMoneyCents(receivables.openInvoicesCents)}) minus payments not yet matched to an
                invoice ({formatMoneyCents(receivables.unappliedCents)}) come to {formatMoneyCents(receivables.openInvoicesCents - receivables.unappliedCents)}. Something is out of step.
              </Text>
            </View>
          )}
          {receivables && receivables.unappliedCents > 0 && (
            <Text style={styles.note}>
              {formatMoneyCents(receivables.unappliedCents)} in customer payments is not matched to an invoice yet. That is fine; match it when you know which invoice it paid.
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

function AccountBlock({ account: a, items }: { account: AccountReconciliation; items: UnlinkedItem[] }) {
  const word = a.isCard ? 'you owe' : 'balance';
  return (
    <View style={styles.block}>
      <Text style={styles.accountName}>{a.name}</Text>
      {a.needsReauth && <Text style={styles.warn}>Reconnect this bank: its balance is out of date.</Text>}
      <Text style={styles.line}>
        Your books ({word}): {formatMoneyCents(a.booksBalanceCents)}  •  Bank ({word}): {formatMoneyCents(a.bankBalanceCents)}
      </Text>

      {a.status === 'needs_starting_balance' && (
        <Text style={styles.warn}>Enter this account&apos;s starting balance (Dashboard) so it can be compared with the bank.</Text>
      )}
      {a.status === 'agrees' && <Text style={styles.good}>They agree.</Text>}
      {(a.status === 'explained_by_open_items' || a.status === 'unexplained') && (
        <View style={styles.breakdown}>
          <Text style={styles.line}>Difference (books minus bank): {signed(a.differenceCents)}</Text>
          {a.unrecordedCount > 0 && (
            <Text style={styles.line}>
              • {a.unrecordedCount} bank transaction{a.unrecordedCount === 1 ? '' : 's'} not recorded yet: {signed(a.unrecordedCents)} on the bank side
            </Text>
          )}
          {a.ignoredCount > 0 && (
            <Text style={styles.line}>
              • {a.ignoredCount} ignored bank transaction{a.ignoredCount === 1 ? '' : 's'}: {signed(a.ignoredCents)} on the bank side
            </Text>
          )}
          {a.unlinkedCount > 0 && (
            <Text style={styles.line}>
              • {a.unlinkedCount} recorded item{a.unlinkedCount === 1 ? '' : 's'} with no matching bank transaction: {signed(a.unlinkedCents)} in your books
            </Text>
          )}
          {a.status === 'unexplained' && a.unexplainedCents !== null && (
            <Text style={styles.warn}>
              {formatMoneyCents(Math.abs(a.unexplainedCents))} {a.unexplainedCents > 0 ? 'more' : 'less'} in your books than the items above explain. Common causes: a starting balance that
              is off, a duplicate, an amount typed differently than the bank shows, or a bank balance that has not refreshed.
            </Text>
          )}
          {a.status === 'explained_by_open_items' && <Text style={styles.good}>Fully explained by the items above. Handle them and the two will agree.</Text>}
        </View>
      )}

      {a.pendingCount > 0 && <Text style={styles.note}>{a.pendingCount} pending transaction{a.pendingCount === 1 ? '' : 's'} not counted until the bank posts them.</Text>}
      {a.beforeStartCount > 0 && (
        <Text style={styles.note}>{a.beforeStartCount} older bank transaction{a.beforeStartCount === 1 ? '' : 's'} dated before the starting balance are already inside it.</Text>
      )}

      {items.length > 0 && (
        <View style={styles.breakdown}>
          <Text style={styles.sub}>Recorded here, but not found in your bank feed</Text>
          {items.map((item) => (
            <Text key={`${item.sourceType}-${item.sourceId}`} style={styles.line}>
              {formatDateDisplay(item.entryDate)} • {SOURCE_LABEL[item.sourceType] ?? item.sourceType}
              {item.memo ? ` - ${item.memo}` : ''} • {signed(item.effectCents)}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { backgroundColor: '#1e1e1e', borderColor: '#323232', borderRadius: 20, borderWidth: 1, marginBottom: 18 },
  header: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between', padding: 18 },
  title: { color: '#ffffff', fontSize: 16, fontWeight: '900' },
  summary: { color: '#ff7a00', fontSize: 13, fontWeight: '800' },
  body: { gap: 14, paddingBottom: 18, paddingHorizontal: 18 },
  block: { backgroundColor: '#252525', borderRadius: 14, gap: 6, padding: 14 },
  accountName: { color: '#ffffff', fontSize: 15, fontWeight: '900' },
  line: { color: '#d4d4d4', fontSize: 13, fontWeight: '600' },
  note: { color: '#a3a3a3', fontSize: 12, fontWeight: '600' },
  good: { color: '#4ade80', fontSize: 13, fontWeight: '800' },
  warn: { color: '#ffb454', fontSize: 13, fontWeight: '700' },
  breakdown: { gap: 4 },
  sub: { color: '#ffffff', fontSize: 13, fontWeight: '800' },
});
