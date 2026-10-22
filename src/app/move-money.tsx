import Head from 'expo-router/head';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';

import { AppShell } from '@/components/AppShell';
import { getCurrentUserId } from '@/data/authStore';
import { PAID_PERSONALLY_LABEL, loadLedgerAccounts, useLedgerAccounts } from '@/data/ledgerAccounts';
import {
  type EquipmentFunding,
  type OpenLoan,
  buyEquipment,
  loadOpenLoans,
  moveBetweenAccounts,
  payCreditCard,
  payLoan,
  putMoneyIn,
  receiveLoan,
  takeMoneyOut,
} from '@/data/moveMoney';
import { parseMoneyInputToCents, formatMoneyCents } from '@/utils/money';
import { normalizeDateToISO, parseFlexibleDate, toISODateString } from '@/utils/date';

type Kind = 'transfer' | 'card' | 'in' | 'out' | 'loan' | 'loanPayment' | 'equipment';

const KINDS: { kind: Kind; label: string; help: string }[] = [
  { kind: 'transfer', label: 'Move money between my accounts', help: 'Checking to savings, for example. Not income or an expense.' },
  { kind: 'card', label: 'Pay a credit card', help: 'Pay your card bill from a bank account. The purchases were already counted when you made them.' },
  { kind: 'in', label: 'I put my own money in', help: 'Money you added to the business from your own pocket.' },
  { kind: 'out', label: 'I took money out for myself', help: 'Money you took out of the business for personal use.' },
  { kind: 'loan', label: 'I received a loan', help: 'Money a lender put in your account that you will pay back.' },
  { kind: 'loanPayment', label: 'I made a loan payment', help: 'Split into what reduces the loan and what is interest.' },
  { kind: 'equipment', label: 'I bought equipment', help: 'One purchase, paid from one or more places (bank, card, your pocket, financing).' },
];

export default function MoveMoneyScreen() {
  const { width } = useWindowDimensions();
  const isCompact = width < 760;
  const { moneyAccounts, loaded } = useLedgerAccounts();
  const banks = useMemo(() => moneyAccounts.filter((account) => account.kind === 'bank'), [moneyAccounts]);
  const cards = useMemo(() => moneyAccounts.filter((account) => account.kind === 'card'), [moneyAccounts]);
  const [kind, setKind] = useState<Kind>('transfer');
  const [date, setDate] = useState(toISODateString(new Date()));
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [name, setName] = useState('');
  const [lender, setLender] = useState('');
  const [loans, setLoans] = useState<OpenLoan[]>([]);
  const [loanId, setLoanId] = useState('');
  const [interest, setInterest] = useState('');
  const [sources, setSources] = useState<FundingDraft[]>([newSource('account')]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const userId = getCurrentUserId();
    if (userId && (kind === 'loanPayment' || kind === 'equipment')) {
      loadOpenLoans(userId).then(setLoans);
    }
  }, [kind]);

  function pick(next: Kind) {
    setKind(next);
    setError('');
    setMessage('');
    setFromId('');
    setToId('');
  }

  const cents = parseMoneyInputToCents(amount);
  const dateOk = !!parseFlexibleDate(date);

  async function submit() {
    setError('');
    setMessage('');
    if (!dateOk) return setError('Enter a valid date.');
    const dateISO = normalizeDateToISO(date);
    setSaving(true);
    try {
      if (kind === 'transfer') {
        need(cents > 0, 'Enter an amount.');
        need(!!fromId && !!toId, 'Choose both accounts.');
        await moveBetweenAccounts({ dateISO, amountCents: cents, fromAccountId: fromId, toAccountId: toId, notes });
      } else if (kind === 'card') {
        need(cents > 0, 'Enter an amount.');
        need(!!fromId && !!toId, 'Choose the bank account and the card.');
        await payCreditCard({ dateISO, amountCents: cents, fromAccountId: fromId, cardAccountId: toId, notes });
      } else if (kind === 'in') {
        need(cents > 0, 'Enter an amount.');
        need(!!toId, 'Choose the account it was deposited to.');
        await putMoneyIn({ dateISO, amountCents: cents, depositedToAccountId: toId, notes });
      } else if (kind === 'out') {
        need(cents > 0, 'Enter an amount.');
        need(!!fromId, 'Choose the account it was paid from.');
        await takeMoneyOut({ dateISO, amountCents: cents, paidFromAccountId: fromId, notes });
      } else if (kind === 'loan') {
        need(cents > 0, 'Enter the loan amount.');
        need(name.trim() !== '', 'Give the loan a name.');
        need(!!toId, 'Choose the account the loan money was deposited to.');
        await receiveLoan({ dateISO, amountCents: cents, name: name.trim(), lender: lender.trim(), depositedToAccountId: toId, notes });
      } else if (kind === 'loanPayment') {
        const interestCents = interest.trim() === '' ? 0 : parseMoneyInputToCents(interest);
        need(!!loanId, 'Choose the loan.');
        need(cents + interestCents > 0, 'Enter the amount that reduces the loan and/or the interest.');
        need(!!fromId, 'Choose the account it was paid from.');
        await payLoan({ loanId, dateISO, principalCents: cents, interestCents, paidFromAccountId: fromId, notes });
      } else {
        need(name.trim() !== '' && cents > 0, 'Enter what you bought and what it cost.');
        const funding: EquipmentFunding[] = sources.map((source) => toFunding(source));
        const total = funding.reduce((sum, source) => sum + source.amountCents, 0);
        need(funding.length > 0 && funding.every((source) => source.amountCents > 0), 'Every place the money came from needs an amount.');
        need(total === cents, `The pieces add up to ${formatMoneyCents(total)} but the cost is ${formatMoneyCents(cents)}.`);
        await buyEquipment({ name: name.trim(), dateISO, costCents: cents, funding, notes });
      }
      setMessage('Saved.');
      setAmount('');
      setNotes('');
      setInterest('');
      setSources([newSource('account')]);
      const userId = getCurrentUserId();
      if (userId) await loadLedgerAccounts(userId);
    } catch (saveError) {
      setError(saveError instanceof Error && saveError.message ? saveError.message : 'Could not save this. Nothing was changed.');
    } finally {
      setSaving(false);
    }
  }

  const info = KINDS.find((item) => item.kind === kind);
  const fromLabel = kind === 'card' || kind === 'loanPayment' || kind === 'out' ? 'Paid from' : 'From';

  return (
    <AppShell activeNav="Move Money">
      <Head>
        <title>Move Money | Blue Collar Books</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>
      <Text style={styles.eyebrow}>Move Money</Text>
      <Text style={[styles.heading, isCompact && styles.headingCompact]}>Record money that is not a sale or an expense.</Text>

      <View style={styles.chips}>
        {KINDS.map((item) => (
          <Pressable key={item.kind} style={[styles.chip, kind === item.kind && styles.chipActive]} onPress={() => pick(item.kind)}>
            <Text style={[styles.chipText, kind === item.kind && styles.chipTextActive]}>{item.label}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.help}>{info?.help}</Text>

        {loaded && moneyAccounts.length === 0 && kind !== 'equipment' && (
          <Text style={styles.help}>Connect a bank account first, so this money has somewhere to come from or go to.</Text>
        )}

        {(kind === 'loan' || kind === 'equipment') && (
          <Field label={kind === 'loan' ? 'Loan name' : 'What did you buy?'} value={name} onChangeText={setName} />
        )}
        {kind === 'loan' && <Field label="Lender" value={lender} onChangeText={setLender} />}

        {kind === 'transfer' && (
          <>
            <Choice label="From" options={banks} value={fromId} onChange={setFromId} />
            <Choice label="To" options={banks.filter((account) => account.id !== fromId)} value={toId} onChange={setToId} />
          </>
        )}
        {kind === 'card' && (
          <>
            <Choice label="Paid from" options={banks} value={fromId} onChange={setFromId} />
            <Choice label="Card" options={cards} value={toId} onChange={setToId} />
          </>
        )}
        {(kind === 'in' || kind === 'loan') && <Choice label="Deposited to" options={banks} value={toId} onChange={setToId} />}
        {(kind === 'out' || kind === 'loanPayment') && <Choice label={fromLabel} options={banks} value={fromId} onChange={setFromId} />}

        {kind === 'loanPayment' && (
          <View style={styles.group}>
            <Text style={styles.label}>Loan</Text>
            <View style={styles.chips}>
              {loans.map((loan) => (
                <Pressable key={loan.id} style={[styles.chip, loanId === loan.id && styles.chipActive]} onPress={() => setLoanId(loan.id)}>
                  <Text style={[styles.chipText, loanId === loan.id && styles.chipTextActive]}>{loan.name}</Text>
                </Pressable>
              ))}
            </View>
            {loans.length === 0 && <Text style={styles.help}>You have not recorded a loan yet.</Text>}
          </View>
        )}

        {kind === 'equipment' && (
          <View style={styles.group}>
            <Text style={styles.label}>Where the money came from</Text>
            {sources.map((source, index) => (
              <FundingRow
                key={source.key}
                source={source}
                banks={moneyAccounts}
                onChange={(next) => setSources(sources.map((item, i) => (i === index ? next : item)))}
                onRemove={sources.length > 1 ? () => setSources(sources.filter((_, i) => i !== index)) : undefined}
              />
            ))}
            <View style={styles.chips}>
              <Pressable style={styles.chip} onPress={() => setSources([...sources, newSource('account')])}>
                <Text style={styles.chipText}>+ Add another place</Text>
              </Pressable>
            </View>
          </View>
        )}

        <View style={styles.row}>
          <Field label="Date" value={date} onChangeText={setDate} />
          <Field
            label={kind === 'equipment' ? 'Total cost' : kind === 'loan' ? 'Loan amount' : kind === 'loanPayment' ? 'Reduces the loan' : 'Amount'}
            value={amount}
            onChangeText={setAmount}
            keyboardType="decimal-pad"
          />
          {kind === 'loanPayment' && <Field label="Interest" value={interest} onChangeText={setInterest} keyboardType="decimal-pad" />}
        </View>
        <Field label="Notes" value={notes} onChangeText={setNotes} />

        {error !== '' && <Text style={styles.error}>{error}</Text>}
        {message !== '' && <Text style={styles.ok}>{message}</Text>}
        <Pressable style={[styles.save, saving && styles.saveDisabled]} disabled={saving} onPress={submit}>
          <Text style={styles.saveText}>{saving ? 'Saving…' : 'Save'}</Text>
        </Pressable>
      </View>
    </AppShell>
  );
}

function need(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

type FundingDraft = {
  key: string;
  type: 'account' | 'owner' | 'loan';
  accountId: string;
  amount: string;
  loanName: string;
  lender: string;
};

let fundingKey = 0;
function newSource(type: FundingDraft['type']): FundingDraft {
  fundingKey += 1;
  return { key: `f${fundingKey}`, type, accountId: '', amount: '', loanName: '', lender: '' };
}

function toFunding(source: FundingDraft): EquipmentFunding {
  const amountCents = parseMoneyInputToCents(source.amount);
  if (source.type === 'owner') return { kind: 'owner', amountCents };
  if (source.type === 'loan') {
    need(source.loanName.trim() !== '', 'Give the financing a name.');
    return { kind: 'loan', name: source.loanName.trim(), lender: source.lender.trim(), amountCents };
  }
  need(!!source.accountId, 'Choose the account for each bank or card piece.');
  return { kind: 'account', accountId: source.accountId, amountCents };
}

function FundingRow({
  source,
  banks,
  onChange,
  onRemove,
}: {
  source: FundingDraft;
  banks: { id: string; name: string }[];
  onChange: (next: FundingDraft) => void;
  onRemove?: () => void;
}) {
  return (
    <View style={styles.fundingRow}>
      <View style={styles.chips}>
        {(
          [
            ['account', 'Bank or card'],
            ['owner', PAID_PERSONALLY_LABEL],
            ['loan', 'Financing'],
          ] as const
        ).map(([type, label]) => (
          <Pressable key={type} style={[styles.chip, source.type === type && styles.chipActive]} onPress={() => onChange({ ...source, type })}>
            <Text style={[styles.chipText, source.type === type && styles.chipTextActive]}>{label}</Text>
          </Pressable>
        ))}
      </View>
      {source.type === 'account' && <Choice label="Paid from" options={banks} value={source.accountId} onChange={(accountId) => onChange({ ...source, accountId })} />}
      {source.type === 'loan' && (
        <View style={styles.row}>
          <Field label="Financing name" value={source.loanName} onChangeText={(loanName) => onChange({ ...source, loanName })} />
          <Field label="Lender" value={source.lender} onChangeText={(lender) => onChange({ ...source, lender })} />
        </View>
      )}
      <Field label="Amount" value={source.amount} onChangeText={(amount) => onChange({ ...source, amount })} keyboardType="decimal-pad" />
      {onRemove && (
        <Pressable onPress={onRemove}>
          <Text style={styles.link}>Remove</Text>
        </Pressable>
      )}
    </View>
  );
}

function Choice({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { id: string; name: string }[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <View style={styles.group}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.chips}>
        {options.map((option) => (
          <Pressable key={option.id} style={[styles.chip, value === option.id && styles.chipActive]} onPress={() => onChange(option.id)}>
            <Text style={[styles.chipText, value === option.id && styles.chipTextActive]}>{option.name}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function Field({
  label,
  value,
  onChangeText,
  keyboardType = 'default',
}: {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  keyboardType?: 'default' | 'decimal-pad';
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput style={styles.input} value={value} onChangeText={onChangeText} keyboardType={keyboardType} placeholderTextColor="#6b6b6b" />
    </View>
  );
}

const styles = StyleSheet.create({
  eyebrow: { color: '#ff7a00', fontSize: 15, fontWeight: '800', marginBottom: 8 },
  heading: { color: '#ffffff', fontSize: 30, fontWeight: '900', marginBottom: 20 },
  headingCompact: { fontSize: 22 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 16 },
  chip: { backgroundColor: '#252525', borderColor: '#383838', borderRadius: 999, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 10 },
  chipActive: { backgroundColor: 'rgba(255, 122, 0, 0.14)', borderColor: 'rgba(255, 122, 0, 0.45)' },
  chipText: { color: '#d4d4d4', fontSize: 14, fontWeight: '800' },
  chipTextActive: { color: '#ff7a00' },
  card: { backgroundColor: '#1e1e1e', borderColor: '#323232', borderRadius: 22, borderWidth: 1, gap: 6, padding: 24 },
  help: { color: '#a3a3a3', fontSize: 14, fontWeight: '600', marginBottom: 12 },
  group: { marginBottom: 6 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  field: { flexBasis: 200, flexGrow: 1, marginBottom: 14 },
  label: { color: '#a3a3a3', fontSize: 13, fontWeight: '800', marginBottom: 8 },
  input: { backgroundColor: '#252525', borderColor: '#383838', borderRadius: 14, borderWidth: 1, color: '#ffffff', fontSize: 16, fontWeight: '700', minHeight: 48, paddingHorizontal: 14, paddingVertical: 10 },
  fundingRow: { backgroundColor: '#222222', borderRadius: 14, marginBottom: 12, padding: 14 },
  link: { color: '#ff7a00', fontSize: 14, fontWeight: '800' },
  error: { color: '#ff6b6b', fontSize: 14, fontWeight: '800', marginTop: 8 },
  ok: { color: '#43a047', fontSize: 14, fontWeight: '800', marginTop: 8 },
  save: { alignSelf: 'flex-start', backgroundColor: '#ff7a00', borderRadius: 16, marginTop: 16, paddingHorizontal: 28, paddingVertical: 14 },
  saveDisabled: { opacity: 0.5 },
  saveText: { color: '#111111', fontSize: 16, fontWeight: '900' },
});
