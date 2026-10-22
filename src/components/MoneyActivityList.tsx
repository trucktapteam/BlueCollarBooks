import { useCallback, useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { getCurrentUserId } from '@/data/authStore';
import { useLedgerAccounts } from '@/data/ledgerAccounts';
import { editActivity, loadMoneyActivity, voidActivity, type MoneyActivity } from '@/data/moveMoney';
import { formatDateDisplay, normalizeDateToISO, parseFlexibleDate } from '@/utils/date';
import { formatMoneyCents, parseMoneyInputToCents } from '@/utils/money';

const EDITABLE = ['transfer', 'card_payment', 'owner_draw', 'owner_contribution', 'refund', 'loan_payment'];

function errorText(err: unknown) {
  if (err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string') {
    return (err as { message: string }).message;
  }
  return 'Could not save this. Nothing was changed.';
}

// Look back at money you recorded and fix it. Editing or voiding never erases
// anything: the original is reversed and the corrected version is recorded.
export function MoneyActivityList({ reloadKey }: { reloadKey: unknown }) {
  const { moneyAccounts } = useLedgerAccounts();
  const [items, setItems] = useState<MoneyActivity[]>([]);
  const [showVoided, setShowVoided] = useState(false);

  const reload = useCallback(async () => {
    const userId = getCurrentUserId();
    if (userId) setItems(await loadMoneyActivity(userId));
  }, []);

  useEffect(() => {
    reload();
  }, [reload, reloadKey]);

  const name = (id: string | null) => moneyAccounts.find((a) => a.id === id)?.name ?? 'an account';
  const visible = items.filter((item) => showVoided || !item.voided);

  function describe(a: MoneyActivity) {
    const amount = formatMoneyCents(a.amountCents);
    switch (a.kind) {
      case 'transfer':
        return `Moved ${amount}: ${name(a.accountId)} to ${name(a.otherAccountId)}`;
      case 'card_payment':
        return `Paid ${amount} on ${name(a.otherAccountId)} from ${name(a.accountId)}`;
      case 'owner_draw':
        return `You took out ${amount} from ${name(a.accountId)}`;
      case 'owner_contribution':
        return `You put in ${amount} to ${name(a.accountId)}`;
      case 'loan_received':
        return `Loan received: ${a.label ?? 'Loan'} - ${amount} into ${name(a.accountId)}`;
      case 'loan_payment':
        return `Loan payment${a.label ? ` (${a.label})` : ''}: ${amount} from ${name(a.accountId)}${a.interestCents ? `, ${formatMoneyCents(a.interestCents)} of it interest` : ''}`;
      case 'refund':
        return `Money back (refund): ${amount} into ${name(a.accountId)}${a.category ? ` - ${a.category}` : ''}`;
      case 'equipment':
        return `Equipment: ${a.label ?? ''} - ${amount}`;
      case 'customer_payment':
        return `Customer payment${a.label ? ` from ${a.label}` : ''}: ${amount} into ${name(a.accountId)}`;
    }
  }

  if (items.length === 0) return null;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>Recent money activity</Text>
        <Pressable onPress={() => setShowVoided((v) => !v)}>
          <Text style={styles.link}>{showVoided ? 'Hide voided' : 'Show voided'}</Text>
        </Pressable>
      </View>
      <Text style={styles.help}>
        Made a mistake? Edit it or void it. Nothing is erased: the old entry is reversed and, for an edit, the corrected one is recorded.
      </Text>
      {visible.map((item) => (
        <ActivityRow key={`${item.kind}-${item.id}`} item={item} text={describe(item)} accounts={moneyAccounts} onChanged={reload} />
      ))}
    </View>
  );
}

function ActivityRow({
  item,
  text,
  accounts,
  onChanged,
}: {
  item: MoneyActivity;
  text: string;
  accounts: { id: string; name: string; kind: 'bank' | 'card' }[];
  onChanged: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmVoid, setConfirmVoid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [date, setDate] = useState(item.dateISO);
  const [amount, setAmount] = useState((item.amountCents / 100).toFixed(2));
  const [interest, setInterest] = useState(((item.interestCents ?? 0) / 100).toFixed(2));
  const [accountId, setAccountId] = useState(item.accountId ?? '');
  const [otherId, setOtherId] = useState(item.otherAccountId ?? '');
  const [notes, setNotes] = useState(item.notes ?? '');

  async function run(action: () => Promise<unknown>) {
    setError('');
    setBusy(true);
    try {
      await action();
      setEditing(false);
      setConfirmVoid(false);
      await onChanged();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  function save() {
    const cents = parseMoneyInputToCents(amount);
    if (!parseFlexibleDate(date)) return setError('Enter a valid date.');
    if (cents <= 0) return setError('Enter an amount.');
    if (!accountId) return setError('Choose the account.');
    if ((item.kind === 'transfer' || item.kind === 'card_payment') && !otherId) return setError('Choose the other account.');
    const interestCents = item.kind === 'loan_payment' ? parseMoneyInputToCents(interest) : undefined;
    return run(() =>
      editActivity(item, { dateISO: normalizeDateToISO(date), amountCents: cents, accountId, otherAccountId: otherId, interestCents, notes })
    );
  }

  const canEdit = !item.voided && EDITABLE.includes(item.kind);
  const bankChoices = accounts.filter((a) => a.kind === 'bank' || item.kind === 'refund');
  const otherChoices = accounts.filter((a) => (item.kind === 'card_payment' ? a.kind === 'card' : a.kind === 'bank') && a.id !== accountId);

  return (
    <View style={[styles.row, item.voided && styles.rowVoided]}>
      <Text style={[styles.text, item.voided && styles.textVoided]}>{text}</Text>
      <Text style={styles.meta}>
        {formatDateDisplay(item.dateISO)}
        {item.voided ? ' • Voided' : ''}
        {item.bankLinked && !item.voided ? ' • Matched to a bank transaction' : ''}
      </Text>

      {editing && (
        <View style={styles.editBox}>
          <Text style={styles.label}>Date</Text>
          <TextInput style={styles.input} value={date} onChangeText={setDate} />
          <Text style={styles.label}>{item.kind === 'loan_payment' ? 'Total payment' : 'Amount'}</Text>
          <TextInput style={styles.input} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
          {item.kind === 'loan_payment' && (
            <>
              <Text style={styles.label}>Interest included</Text>
              <TextInput style={styles.input} value={interest} onChangeText={setInterest} keyboardType="decimal-pad" />
            </>
          )}
          <Text style={styles.label}>{item.kind === 'owner_contribution' || item.kind === 'refund' ? 'Into' : 'From'}</Text>
          <View style={styles.chips}>
            {bankChoices.map((a) => (
              <Pressable key={a.id} style={[styles.chip, accountId === a.id && styles.chipActive]} onPress={() => setAccountId(a.id)}>
                <Text style={[styles.chipText, accountId === a.id && styles.chipTextActive]}>{a.name}</Text>
              </Pressable>
            ))}
          </View>
          {(item.kind === 'transfer' || item.kind === 'card_payment') && (
            <>
              <Text style={styles.label}>To</Text>
              <View style={styles.chips}>
                {otherChoices.map((a) => (
                  <Pressable key={a.id} style={[styles.chip, otherId === a.id && styles.chipActive]} onPress={() => setOtherId(a.id)}>
                    <Text style={[styles.chipText, otherId === a.id && styles.chipTextActive]}>{a.name}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}
          <Text style={styles.label}>Notes</Text>
          <TextInput style={styles.input} value={notes} onChangeText={setNotes} />
          {item.bankLinked && (
            <Text style={styles.meta}>This is matched to a bank transaction. To change its amount or account, unlink it in the Bank Feed first.</Text>
          )}
        </View>
      )}

      {!!error && <Text style={styles.error}>{error}</Text>}

      {!item.voided && (
        <View style={styles.actions}>
          {canEdit && !editing && (
            <Pressable style={styles.button} onPress={() => setEditing(true)} disabled={busy}>
              <Text style={styles.buttonText}>Edit</Text>
            </Pressable>
          )}
          {editing && (
            <>
              <Pressable style={styles.buttonPrimary} onPress={save} disabled={busy}>
                <Text style={styles.buttonPrimaryText}>{busy ? 'Saving…' : 'Save changes'}</Text>
              </Pressable>
              <Pressable style={styles.button} onPress={() => setEditing(false)} disabled={busy}>
                <Text style={styles.buttonText}>Cancel</Text>
              </Pressable>
            </>
          )}
          {!editing &&
            (confirmVoid ? (
              <>
                <Pressable style={styles.buttonDanger} onPress={() => run(() => voidActivity(item))} disabled={busy}>
                  <Text style={styles.buttonPrimaryText}>{busy ? 'Voiding…' : 'Yes, void it'}</Text>
                </Pressable>
                <Pressable style={styles.button} onPress={() => setConfirmVoid(false)} disabled={busy}>
                  <Text style={styles.buttonText}>Keep it</Text>
                </Pressable>
              </>
            ) : (
              <Pressable style={styles.button} onPress={() => setConfirmVoid(true)} disabled={busy}>
                <Text style={styles.buttonText}>Void</Text>
              </Pressable>
            ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#1e1e1e', borderColor: '#323232', borderRadius: 20, borderWidth: 1, gap: 12, marginTop: 24, padding: 22 },
  header: { flexDirection: 'row', justifyContent: 'space-between' },
  title: { color: '#ffffff', fontSize: 18, fontWeight: '900' },
  link: { color: '#ff7a00', fontSize: 13, fontWeight: '800' },
  help: { color: '#a3a3a3', fontSize: 13, fontWeight: '600' },
  row: { backgroundColor: '#252525', borderRadius: 14, gap: 6, padding: 14 },
  rowVoided: { opacity: 0.55 },
  text: { color: '#ffffff', fontSize: 14, fontWeight: '800' },
  textVoided: { textDecorationLine: 'line-through' },
  meta: { color: '#a3a3a3', fontSize: 12, fontWeight: '600' },
  editBox: { gap: 6, marginTop: 6 },
  label: { color: '#d4d4d4', fontSize: 12, fontWeight: '800', marginTop: 4 },
  input: { backgroundColor: '#1e1e1e', borderColor: '#383838', borderRadius: 10, borderWidth: 1, color: '#ffffff', fontSize: 14, fontWeight: '700', paddingHorizontal: 12, paddingVertical: 9 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { backgroundColor: '#1e1e1e', borderColor: '#383838', borderRadius: 999, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 7 },
  chipActive: { backgroundColor: 'rgba(255, 122, 0, 0.14)', borderColor: 'rgba(255, 122, 0, 0.45)' },
  chipText: { color: '#d4d4d4', fontSize: 12, fontWeight: '800' },
  chipTextActive: { color: '#ff7a00' },
  error: { color: '#ff6b6b', fontSize: 13, fontWeight: '700' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 6 },
  button: { backgroundColor: '#1e1e1e', borderColor: '#343434', borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 9 },
  buttonText: { color: '#d4d4d4', fontSize: 13, fontWeight: '900' },
  buttonPrimary: { backgroundColor: '#ff7a00', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 9 },
  buttonDanger: { backgroundColor: '#c2410c', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 9 },
  buttonPrimaryText: { color: '#111111', fontSize: 13, fontWeight: '900' },
});
