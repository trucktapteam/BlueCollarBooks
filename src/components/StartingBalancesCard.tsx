import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import {
  type MoneyAccount,
  type StartingBalance,
  loadStartingBalances,
  setStartingBalance,
  useLedgerAccounts,
} from '@/data/ledgerAccounts';
import { formatMoneyCents, parseMoneyInputToCents } from '@/utils/money';
import { normalizeDateToISO, parseFlexibleDate, toISODateString } from '@/utils/date';

// Cash Available is only as good as where each account started. The books
// can't know what was in an account before this app, so the owner tells us:
// "On this date, this account held this much" (for a card: this much owed).
export function StartingBalancesCard({ onChanged }: { onChanged: () => void }) {
  const { moneyAccounts } = useLedgerAccounts();
  const [balances, setBalances] = useState<StartingBalance[]>([]);
  const [open, setOpen] = useState(false);

  async function refresh() {
    setBalances(await loadStartingBalances());
  }

  useEffect(() => {
    refresh();
  }, [moneyAccounts.length]);

  if (moneyAccounts.length === 0) return null;

  const missing = moneyAccounts.filter((account) => !balances.some((balance) => balance.accountId === account.id));

  if (missing.length === 0 && !open) {
    return (
      <Pressable onPress={() => setOpen(true)}>
        <Text style={styles.link}>Change starting balances</Text>
      </Pressable>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Set your starting balances</Text>
      <Text style={styles.copy}>
        Tell us what each account held on the day you start tracking here (for a credit card, what you owed). Cash
        Available is only accurate once these are set.
      </Text>
      {moneyAccounts.map((account) => (
        <StartingBalanceRow
          key={account.id}
          account={account}
          existing={balances.find((balance) => balance.accountId === account.id)}
          onSaved={async () => {
            await refresh();
            onChanged();
          }}
        />
      ))}
      {open && missing.length === 0 && (
        <Pressable onPress={() => setOpen(false)}>
          <Text style={styles.link}>Done</Text>
        </Pressable>
      )}
    </View>
  );
}

function StartingBalanceRow({
  account,
  existing,
  onSaved,
}: {
  account: MoneyAccount;
  existing?: StartingBalance;
  onSaved: () => Promise<void>;
}) {
  const [amount, setAmount] = useState(existing ? formatMoneyCents(existing.amountCents) : '');
  const [asOf, setAsOf] = useState(existing?.asOf ?? toISODateString(new Date()));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (existing) {
      setAmount(formatMoneyCents(existing.amountCents));
      setAsOf(existing.asOf);
    }
  }, [existing]);

  const validDate = !!parseFlexibleDate(asOf);
  const canSave = amount.trim() !== '' && validDate && !saving;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setError('');
    try {
      await setStartingBalance(account.id, parseMoneyInputToCents(amount), normalizeDateToISO(asOf));
      await onSaved();
    } catch (saveError) {
      setError(saveError instanceof Error && saveError.message ? saveError.message : 'Could not save. Nothing was changed.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.row}>
      <Text style={styles.accountName}>{account.name}</Text>
      <Text style={styles.label}>{account.kind === 'card' ? 'Amount owed' : 'Balance'}</Text>
      <TextInput
        style={styles.input}
        keyboardType="decimal-pad"
        placeholder="0.00"
        placeholderTextColor="#6b6b6b"
        value={amount}
        onChangeText={setAmount}
      />
      <Text style={styles.label}>As of</Text>
      <TextInput style={styles.input} placeholder="YYYY-MM-DD" placeholderTextColor="#6b6b6b" value={asOf} onChangeText={setAsOf} />
      <Pressable style={[styles.button, !canSave && styles.buttonDisabled]} disabled={!canSave} onPress={save}>
        <Text style={styles.buttonText}>{existing ? 'Update' : 'Save'}</Text>
      </Pressable>
      {error !== '' && <Text style={styles.error}>{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(255, 122, 0, 0.08)',
    borderColor: 'rgba(255, 122, 0, 0.32)',
    borderRadius: 18,
    borderWidth: 1,
    gap: 12,
    marginBottom: 24,
    padding: 20,
  },
  title: { color: '#ffffff', fontSize: 18, fontWeight: '900' },
  copy: { color: '#a3a3a3', fontSize: 14, fontWeight: '600' },
  row: { alignItems: 'center', flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  accountName: { color: '#f5f5f5', fontSize: 15, fontWeight: '800', minWidth: 160 },
  label: { color: '#737373', fontSize: 12, fontWeight: '900', textTransform: 'uppercase' },
  input: {
    backgroundColor: '#252525',
    borderColor: '#353535',
    borderRadius: 10,
    borderWidth: 1,
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
    minWidth: 110,
    padding: 10,
  },
  button: { backgroundColor: '#ff7a00', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 10 },
  buttonDisabled: { opacity: 0.45 },
  buttonText: { color: '#111111', fontSize: 14, fontWeight: '900' },
  error: { color: '#ff6b6b', fontSize: 13, fontWeight: '800', width: '100%' },
  link: { color: '#ff7a00', fontSize: 14, fontWeight: '800', marginBottom: 16 },
});
