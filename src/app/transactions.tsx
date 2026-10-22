import { router } from 'expo-router';
import Head from 'expo-router/head';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';

import { AppShell } from '@/components/AppShell';
import { ReconciliationPanel } from '@/components/ReconciliationPanel';
import { useSession } from '@/data/authStore';
import { useCategories } from '@/data/mockCategories';
import { useCustomers } from '@/data/mockCustomers';
import { useInvoices } from '@/data/mockInvoices';
import { useLedgerAccounts } from '@/data/ledgerAccounts';
import { loadOpenLoans, type OpenLoan } from '@/data/moveMoney';
import {
  confirmTransferPair,
  excludeTransaction,
  isPossibleDuplicateError,
  loadBankCandidates,
  loadPlaidTransactions,
  loadTransferProposals,
  matchTransaction,
  resolveTransaction,
  restoreTransaction,
  undoTransaction,
  usePlaidTransactions,
  type BankCandidate,
  type BankMatchKind,
  type PlaidTransaction,
  type ResolveKind,
  type ResolveParams,
  type TransferProposal,
} from '@/data/mockPlaidTransactions';
import { calculateInvoiceBalance } from '@/utils/invoiceMath';
import { formatMoneyCents } from '@/utils/money';
import { formatDateDisplay } from '@/utils/date';
import { suggestExpenseCategory } from '@/utils/suggestCategory';

type Tab = 'review' | 'pending' | 'recorded' | 'excluded';

const KIND_LABEL: Record<BankMatchKind, string> = {
  expense: 'a business expense',
  payment: 'a customer payment',
  owner_draw: 'money you took out',
  owner_contribution: 'money you put in',
  transfer: 'a move between your accounts',
  loan_received: 'a loan you received',
  loan_payment: 'a loan payment',
  refund: 'money back (a refund)',
};

export default function TransactionsScreen() {
  const { width } = useWindowDimensions();
  const isCompact = width < 760;
  const session = useSession();
  const transactions = usePlaidTransactions();
  const [tab, setTab] = useState<Tab>('review');
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState('');
  const [proposals, setProposals] = useState<TransferProposal[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const { moneyAccounts } = useLedgerAccounts();

  const byState = useMemo(() => {
    const sorted = [...transactions].sort((a, b) => (a.date < b.date ? 1 : -1));
    return {
      review: sorted.filter((t) => t.state === 'needs_review' || t.state === 'unsure'),
      pending: sorted.filter((t) => t.state === 'pending'),
      recorded: sorted.filter((t) => t.state === 'recorded'),
      excluded: sorted.filter((t) => t.state === 'excluded'),
    };
  }, [transactions]);

  // Re-ask for transfer pairs whenever the feed changes.
  useEffect(() => {
    let live = true;
    loadTransferProposals().then((rows) => live && setProposals(rows));
    return () => {
      live = false;
    };
  }, [transactions]);

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

  const visibleProposals = proposals.filter((p) => !dismissed.includes(`${p.outTxn}|${p.inTxn}`));
  const accountName = (id: string) => moneyAccounts.find((a) => a.id === id)?.name ?? 'another account';
  const list = byState[tab];

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'review', label: 'To review', count: byState.review.length },
    { key: 'pending', label: 'Pending', count: byState.pending.length },
    { key: 'recorded', label: 'Recorded', count: byState.recorded.length },
    { key: 'excluded', label: 'Ignored', count: byState.excluded.length },
  ];

  return (
    <AppShell activeNav="Expenses">
      <Head>
        <title>Bank Feed | Blue Collar Books</title>
        <meta name="robots" content="noindex, nofollow" />
      </Head>

      <View style={styles.pageHeader}>
        <View style={styles.pageHeaderText}>
          <Text style={styles.eyebrow}>Bank Feed</Text>
          <Text style={[styles.heading, isCompact && styles.headingCompact]}>Tell your books what each bank transaction was.</Text>
          <Text style={styles.subheading}>
            Money in and money out. If you already recorded it, match it - that keeps one real transaction as one. Pending ones can be
            recorded once the bank posts them.
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

      <ReconciliationPanel refreshKey={transactions} />

      <View style={styles.tabs}>
        {tabs.map((item) => (
          <Pressable key={item.key} style={[styles.tab, tab === item.key && styles.tabActive]} onPress={() => setTab(item.key)}>
            <Text style={[styles.tabText, tab === item.key && styles.tabTextActive]}>
              {item.label} ({item.count})
            </Text>
          </Pressable>
        ))}
      </View>

      {tab === 'review' && visibleProposals.length > 0 && (
        <View style={styles.proposalBlock}>
          <Text style={styles.blockTitle}>These look like moves between your own accounts</Text>
          {visibleProposals.map((p) => (
            <ProposalCard
              key={`${p.outTxn}|${p.inTxn}`}
              proposal={p}
              fromName={accountName(p.outAccountId)}
              toName={accountName(p.inAccountId)}
              onDismiss={() => setDismissed((d) => [...d, `${p.outTxn}|${p.inTxn}`])}
            />
          ))}
        </View>
      )}

      {list.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyTitle}>{tab === 'review' ? 'Nothing to review.' : 'Nothing here.'}</Text>
          <Text style={styles.emptyText}>
            {transactions.length === 0
              ? 'Once your bank is connected, tap Sync Now to pull in recent transactions.'
              : tab === 'review'
                ? "You're caught up - every posted bank transaction has been recorded or ignored."
                : 'Nothing in this list right now.'}
          </Text>
        </View>
      ) : (
        <View style={styles.list}>
          {list.map((transaction) =>
            tab === 'review' ? (
              <ReviewRow key={transaction.id} transaction={transaction} />
            ) : (
              <StatusRow key={transaction.id} transaction={transaction} tab={tab} />
            )
          )}
        </View>
      )}
    </AppShell>
  );
}

function ProposalCard({
  proposal,
  fromName,
  toName,
  onDismiss,
}: {
  proposal: TransferProposal;
  fromName: string;
  toName: string;
  onDismiss: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function confirm() {
    setError('');
    setBusy(true);
    try {
      await confirmTransferPair(proposal.outTxn, proposal.inTxn);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.row}>
      <Text style={styles.rowVendor}>
        {formatMoneyCents(proposal.amountCents)} {proposal.kind === 'card_payment' ? 'paid to a card' : 'moved'}: {fromName} → {toName}
      </Text>
      <Text style={styles.rowMeta}>
        Left {fromName} on {formatDateDisplay(proposal.outDate)}, arrived in {toName} on {formatDateDisplay(proposal.inDate)}.
        {proposal.ambiguous ? ' More than one pairing is possible - check this is the right one.' : ''}
      </Text>
      <Text style={styles.noteText}>
        This is not income or an expense. It only moves money between your own accounts.
      </Text>
      {!!error && <Text style={styles.rowErrorText}>{error}</Text>}
      <View style={styles.rowActions}>
        <Pressable style={styles.secondaryButton} onPress={onDismiss} disabled={busy}>
          <Text style={styles.secondaryButtonText}>Not a transfer</Text>
        </Pressable>
        <Pressable style={styles.primaryButton} onPress={confirm} disabled={busy}>
          <Text style={styles.primaryButtonText}>{busy ? 'Saving…' : 'Yes, it is a transfer'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

function errorText(err: unknown) {
  if (err && typeof err === 'object' && 'message' in err && typeof (err as { message: unknown }).message === 'string') {
    return (err as { message: string }).message;
  }
  return 'Something went wrong. Try again.';
}

function TxnHeader({ transaction }: { transaction: PlaidTransaction }) {
  const moneyIn = transaction.amount < 0;
  return (
    <View style={styles.rowTop}>
      <View style={styles.rowPrimary}>
        <Text style={styles.rowVendor}>{transaction.merchantName || transaction.name}</Text>
        <Text style={styles.rowMeta}>
          {formatDateDisplay(transaction.date)}
          {transaction.accountName ? ` • ${transaction.accountName}` : ''}
          {transaction.pending ? ' • Pending' : ''}
        </Text>
      </View>
      <View style={styles.amountBlock}>
        <Text style={[styles.rowAmount, moneyIn && styles.rowAmountIn]}>
          {moneyIn ? '+' : '-'}
          {formatMoneyCents(Math.abs(transaction.amount))}
        </Text>
        <Text style={styles.rowMeta}>{moneyIn ? 'Money in' : 'Money out'}</Text>
      </View>
    </View>
  );
}

function StatusRow({ transaction, tab }: { transaction: PlaidTransaction; tab: Tab }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function run(action: () => Promise<void>) {
    setError('');
    setBusy(true);
    try {
      await action();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.row}>
      <TxnHeader transaction={transaction} />
      {tab === 'pending' && <Text style={styles.noteText}>Still pending at the bank. You can record it once it posts.</Text>}
      {tab === 'recorded' && transaction.matchKind && (
        <Text style={styles.noteText}>
          Recorded as {KIND_LABEL[transaction.matchKind]}
          {transaction.matchCreatedEvent ? '' : ' you had already entered'}.
        </Text>
      )}
      {tab === 'excluded' && (
        <Text style={styles.noteText}>Ignored. Your books will not match your bank for this one until you handle it.</Text>
      )}
      {!!error && <Text style={styles.rowErrorText}>{error}</Text>}
      <View style={styles.rowActions}>
        {tab === 'recorded' && (
          <Pressable style={styles.secondaryButton} disabled={busy} onPress={() => run(() => undoTransaction(transaction.id))}>
            <Text style={styles.secondaryButtonText}>
              {busy ? 'Working…' : transaction.matchCreatedEvent ? 'Undo (removes what was recorded)' : 'Unlink'}
            </Text>
          </Pressable>
        )}
        {tab === 'excluded' && (
          <Pressable style={styles.secondaryButton} disabled={busy} onPress={() => run(() => restoreTransaction(transaction.id))}>
            <Text style={styles.secondaryButtonText}>{busy ? 'Working…' : 'Put back in review'}</Text>
          </Pressable>
        )}
        {tab === 'pending' && !transaction.excluded && (
          <Pressable style={styles.secondaryButton} disabled={busy} onPress={() => run(() => excludeTransaction(transaction.id))}>
            <Text style={styles.secondaryButtonText}>{busy ? 'Working…' : 'Ignore'}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

type Choice = ResolveKind | null;

function ReviewRow({ transaction }: { transaction: PlaidTransaction }) {
  const moneyIn = transaction.amount < 0;
  const amountCents = Math.abs(transaction.amount);
  const categories = useCategories();
  const categoryNames = categories.map((c) => c.name);
  const customers = useCustomers();
  const invoices = useInvoices();
  const { moneyAccounts } = useLedgerAccounts();
  const session = useSession();

  const [candidates, setCandidates] = useState<BankCandidate[] | null>(null);
  const [choice, setChoice] = useState<Choice>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [needsConfirm, setNeedsConfirm] = useState(false);

  const [category, setCategory] = useState(() => {
    const suggested = suggestExpenseCategory([transaction.plaidCategory]);
    return categoryNames.includes(suggested) ? suggested : (categoryNames[0] ?? suggested);
  });
  const [otherAccountId, setOtherAccountId] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [invoiceIds, setInvoiceIds] = useState<string[]>([]);
  const [loans, setLoans] = useState<OpenLoan[]>([]);
  const [loanId, setLoanId] = useState('');
  const [interest, setInterest] = useState('');
  const [loanName, setLoanName] = useState('');
  const [lender, setLender] = useState('');
  const [note, setNote] = useState(transaction.reviewNote ?? '');

  useEffect(() => {
    let live = true;
    loadBankCandidates(transaction.id).then((rows) => live && setCandidates(rows));
    return () => {
      live = false;
    };
  }, [transaction.id]);

  useEffect(() => {
    if (choice === 'loan_payment' && session?.user.id) {
      loadOpenLoans(session.user.id).then((rows) => {
        setLoans(rows);
        if (!loanId && rows[0]) setLoanId(rows[0].id);
      });
    }
  }, [choice, session?.user.id, loanId]);

  const otherAccounts = moneyAccounts.filter((a) => a.id !== transaction.accountId && (moneyIn ? a.kind === 'bank' : true));
  const openInvoices = invoices.filter((inv) => inv.customerId === customerId && inv.status !== 'Draft' && calculateInvoiceBalance(inv) > 0);

  function applications() {
    let remaining = amountCents;
    const result: { invoice_id: string; amount_cents: number }[] = [];
    for (const inv of openInvoices) {
      if (!invoiceIds.includes(inv.id) || remaining <= 0) continue;
      const apply = Math.min(calculateInvoiceBalance(inv), remaining);
      if (apply > 0) {
        result.push({ invoice_id: inv.id, amount_cents: apply });
        remaining -= apply;
      }
    }
    return result;
  }

  async function submit(kind: ResolveKind, params: ResolveParams = {}) {
    setError('');
    setBusy(true);
    try {
      await resolveTransaction(transaction.id, kind, { ...params, confirmNew: needsConfirm || params.confirmNew });
    } catch (err) {
      if (isPossibleDuplicateError(err)) {
        setNeedsConfirm(true);
        loadBankCandidates(transaction.id).then(setCandidates);
        setError(errorText(err));
      } else {
        setError(errorText(err));
      }
    } finally {
      setBusy(false);
    }
  }

  async function match(candidate: BankCandidate) {
    setError('');
    setBusy(true);
    try {
      await matchTransaction(transaction.id, candidate);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function ignore() {
    setError('');
    setBusy(true);
    try {
      await excludeTransaction(transaction.id);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  const outChoices: { key: ResolveKind; label: string }[] = [
    { key: 'expense', label: 'A business expense' },
    { key: 'owner_draw', label: 'I took money out' },
    { key: 'loan_payment', label: 'A loan payment' },
    { key: 'transfer_to', label: 'Moved to my other account / paid a card' },
    { key: 'unsure', label: 'Not sure' },
  ];
  const inChoices: { key: ResolveKind; label: string }[] = [
    { key: 'customer_payment', label: 'A customer paid me' },
    { key: 'owner_contribution', label: 'I put money in' },
    { key: 'loan_received', label: 'A loan I received' },
    { key: 'transfer_from', label: 'Moved from my other account' },
    { key: 'refund', label: 'Refund / money back' },
    { key: 'unsure', label: 'Other / not sure' },
  ];
  const choices = moneyIn ? inChoices : outChoices;
  const hasCandidates = (candidates?.length ?? 0) > 0;

  return (
    <View style={styles.row}>
      <TxnHeader transaction={transaction} />

      {transaction.state === 'unsure' && (
        <Text style={styles.noteText}>Marked not sure{transaction.reviewNote ? `: ${transaction.reviewNote}` : '.'} Nothing has been recorded.</Text>
      )}
      {!transaction.state.includes('unsure') && !!transaction.reviewNote && <Text style={styles.noteText}>{transaction.reviewNote}</Text>}

      {hasCandidates && (
        <View style={styles.candidateBlock}>
          <Text style={styles.blockTitle}>Already in your books?</Text>
          {candidates?.map((c) => (
            <View key={`${c.kind}-${c.targetId}-${c.side ?? ''}`} style={styles.candidateRow}>
              <View style={styles.rowPrimary}>
                <Text style={styles.candidateLabel}>{c.label}</Text>
                <Text style={styles.rowMeta}>
                  {formatDateDisplay(c.eventDate)} • {formatMoneyCents(c.amountCents)}
                  {c.dayDiff > 0 ? ` • ${c.dayDiff} day${c.dayDiff === 1 ? '' : 's'} apart` : ''}
                </Text>
              </View>
              <Pressable style={styles.primaryButton} disabled={busy} onPress={() => match(c)}>
                <Text style={styles.primaryButtonText}>That's it</Text>
              </Pressable>
            </View>
          ))}
          <Text style={styles.noteText}>Matching links the two. Nothing new is added to your books.</Text>
        </View>
      )}

      <Text style={styles.blockTitle}>{hasCandidates ? 'Or it is something new:' : 'What was this?'}</Text>
      <View style={styles.chipGrid}>
        {choices.map((option) => (
          <Pressable
            key={option.key}
            disabled={busy}
            style={[styles.chip, choice === option.key && styles.chipActive]}
            onPress={() => {
              setChoice(option.key);
              setError('');
            }}
          >
            <Text style={[styles.chipText, choice === option.key && styles.chipTextActive]}>{option.label}</Text>
          </Pressable>
        ))}
      </View>

      {(choice === 'expense' || choice === 'refund') && (
        <View>
          <Text style={styles.fieldLabel}>{choice === 'refund' ? 'Which kind of expense does this refund reduce?' : 'Expense type'}</Text>
          <View style={styles.chipGrid}>
            {categoryNames.map((name) => (
              <Pressable key={name} style={[styles.chip, category === name && styles.chipActive]} onPress={() => setCategory(name)}>
                <Text style={[styles.chipText, category === name && styles.chipTextActive]}>{name}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      )}

      {(choice === 'transfer_to' || choice === 'transfer_from') && (
        <View>
          <Text style={styles.fieldLabel}>{choice === 'transfer_to' ? 'Moved to' : 'Moved from'}</Text>
          <View style={styles.chipGrid}>
            {otherAccounts.map((account) => (
              <Pressable
                key={account.id}
                style={[styles.chip, otherAccountId === account.id && styles.chipActive]}
                onPress={() => setOtherAccountId(account.id)}
              >
                <Text style={[styles.chipText, otherAccountId === account.id && styles.chipTextActive]}>{account.name}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.noteText}>Not income and not an expense. Both sides of a move appear in your bank feed; if the other side is there, confirm the pair above instead.</Text>
        </View>
      )}

      {choice === 'loan_payment' && (
        <View>
          <Text style={styles.fieldLabel}>Which loan?</Text>
          <View style={styles.chipGrid}>
            {loans.length === 0 && <Text style={styles.noteText}>No loans yet. Record the loan first (Move Money, or when it arrived as money in).</Text>}
            {loans.map((loan) => (
              <Pressable key={loan.id} style={[styles.chip, loanId === loan.id && styles.chipActive]} onPress={() => setLoanId(loan.id)}>
                <Text style={[styles.chipText, loanId === loan.id && styles.chipTextActive]}>{loan.name}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.fieldLabel}>How much of {formatMoneyCents(amountCents)} was interest? (the rest pays down the loan)</Text>
          <TextInput style={styles.input} placeholder="0.00" placeholderTextColor="#6b6b6b" value={interest} onChangeText={setInterest} keyboardType="decimal-pad" />
        </View>
      )}

      {choice === 'loan_received' && (
        <View>
          <Text style={styles.fieldLabel}>Loan name</Text>
          <TextInput style={styles.input} placeholder="Truck loan" placeholderTextColor="#6b6b6b" value={loanName} onChangeText={setLoanName} />
          <Text style={styles.fieldLabel}>Lender</Text>
          <TextInput style={styles.input} placeholder="First Bank" placeholderTextColor="#6b6b6b" value={lender} onChangeText={setLender} />
          <Text style={styles.noteText}>Borrowed money is not income. You will owe it back.</Text>
        </View>
      )}

      {choice === 'customer_payment' && (
        <View>
          <Text style={styles.fieldLabel}>Who paid?</Text>
          <View style={styles.chipGrid}>
            {customers.map((customer) => (
              <Pressable
                key={customer.id}
                style={[styles.chip, customerId === customer.id && styles.chipActive]}
                onPress={() => {
                  setCustomerId(customer.id);
                  setInvoiceIds([]);
                }}
              >
                <Text style={[styles.chipText, customerId === customer.id && styles.chipTextActive]}>{customer.name}</Text>
              </Pressable>
            ))}
          </View>
          {!!customerId && (
            <View>
              <Text style={styles.fieldLabel}>Which invoices did it pay? (optional)</Text>
              <View style={styles.chipGrid}>
                {openInvoices.length === 0 && <Text style={styles.noteText}>No open invoices. It will be saved as a payment not yet matched to an invoice.</Text>}
                {openInvoices.map((inv) => {
                  const active = invoiceIds.includes(inv.id);
                  return (
                    <Pressable
                      key={inv.id}
                      style={[styles.chip, active && styles.chipActive]}
                      onPress={() => setInvoiceIds((ids) => (active ? ids.filter((x) => x !== inv.id) : [...ids, inv.id]))}
                    >
                      <Text style={[styles.chipText, active && styles.chipTextActive]}>
                        #{inv.invoice} • {formatMoneyCents(calculateInvoiceBalance(inv))} due
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          )}
          <Text style={styles.noteText}>Money you get from a customer counts as income only through this payment record.</Text>
        </View>
      )}

      {choice === 'unsure' && (
        <View>
          <Text style={styles.fieldLabel}>A note for yourself or your accountant (optional)</Text>
          <TextInput style={styles.input} placeholder="Ask about this one" placeholderTextColor="#6b6b6b" value={note} onChangeText={setNote} />
          <Text style={styles.noteText}>Nothing is recorded. It stays here until you decide.</Text>
        </View>
      )}

      {!!error && <Text style={styles.rowErrorText}>{error}</Text>}
      {needsConfirm && (
        <Text style={styles.noteText}>If this really is a separate one, save again to confirm.</Text>
      )}

      <View style={styles.rowActions}>
        <Pressable style={styles.secondaryButton} onPress={ignore} disabled={busy}>
          <Text style={styles.secondaryButtonText}>Not a business transaction</Text>
        </Pressable>
        {!!choice && (
          <Pressable
            style={styles.primaryButton}
            disabled={busy}
            onPress={() => {
              if (choice === 'expense' || choice === 'refund') return submit(choice, { category });
              if (choice === 'transfer_to' || choice === 'transfer_from') {
                if (!otherAccountId) return setError('Choose the other account.');
                return submit(choice, { otherAccountId });
              }
              if (choice === 'loan_payment') {
                if (!loanId) return setError('Choose the loan.');
                const interestCents = Math.round((parseFloat(interest) || 0) * 100);
                return submit(choice, { loanId, interestCents });
              }
              if (choice === 'loan_received') return submit(choice, { name: loanName.trim() || 'Loan', lender: lender.trim() });
              if (choice === 'customer_payment') {
                if (!customerId) return setError('Choose who paid.');
                return submit(choice, { customerId, applications: applications() });
              }
              if (choice === 'unsure') return submit(choice, { notes: note });
              return submit(choice);
            }}
          >
            <Text style={styles.primaryButtonText}>{busy ? 'Saving…' : choice === 'unsure' ? 'Mark not sure' : needsConfirm ? 'Yes, record it as separate' : 'Save'}</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  pageHeader: { alignItems: 'flex-start', flexDirection: 'row', flexWrap: 'wrap', gap: 24, justifyContent: 'space-between', marginBottom: 24 },
  pageHeaderText: { flexShrink: 1, minWidth: 0 },
  eyebrow: { color: '#ff7a00', fontSize: 15, fontWeight: '800', marginBottom: 8 },
  heading: { color: '#ffffff', fontSize: 34, fontWeight: '900', letterSpacing: 0 },
  headingCompact: { fontSize: 24 },
  subheading: { color: '#a3a3a3', fontSize: 15, fontWeight: '600', marginTop: 8, maxWidth: 560 },
  headerActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  syncButton: { backgroundColor: '#ff7a00', borderRadius: 16, paddingHorizontal: 20, paddingVertical: 14 },
  syncButtonText: { color: '#111111', fontSize: 15, fontWeight: '900' },
  backButton: { backgroundColor: '#252525', borderColor: '#343434', borderRadius: 16, borderWidth: 1, paddingHorizontal: 18, paddingVertical: 14 },
  backButtonText: { color: '#d4d4d4', fontSize: 15, fontWeight: '800' },
  syncErrorText: { color: '#ff6b6b', fontSize: 13, fontWeight: '700', marginBottom: 16 },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 18 },
  tab: { backgroundColor: '#252525', borderColor: '#383838', borderRadius: 999, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 9 },
  tabActive: { backgroundColor: 'rgba(255, 122, 0, 0.14)', borderColor: 'rgba(255, 122, 0, 0.45)' },
  tabText: { color: '#d4d4d4', fontSize: 13, fontWeight: '800' },
  tabTextActive: { color: '#ff7a00' },
  proposalBlock: { gap: 12, marginBottom: 18 },
  blockTitle: { color: '#ffffff', fontSize: 14, fontWeight: '900' },
  emptyState: { backgroundColor: '#1e1e1e', borderColor: '#323232', borderRadius: 22, borderWidth: 1, padding: 40 },
  emptyTitle: { color: '#ffffff', fontSize: 20, fontWeight: '900', marginBottom: 8 },
  emptyText: { color: '#a3a3a3', fontSize: 15, fontWeight: '600', maxWidth: 460 },
  list: { gap: 14 },
  row: { backgroundColor: '#1e1e1e', borderColor: '#323232', borderRadius: 20, borderWidth: 1, gap: 12, padding: 22 },
  rowTop: { alignItems: 'flex-start', flexDirection: 'row', gap: 16, justifyContent: 'space-between' },
  rowPrimary: { flex: 1, gap: 4 },
  rowVendor: { color: '#ffffff', fontSize: 17, fontWeight: '900' },
  rowMeta: { color: '#a3a3a3', fontSize: 13, fontWeight: '700' },
  amountBlock: { alignItems: 'flex-end', gap: 2 },
  rowAmount: { color: '#ffffff', fontSize: 20, fontWeight: '900' },
  rowAmountIn: { color: '#4ade80' },
  noteText: { color: '#a3a3a3', fontSize: 13, fontWeight: '600' },
  candidateBlock: { backgroundColor: 'rgba(74, 222, 128, 0.07)', borderColor: 'rgba(74, 222, 128, 0.3)', borderRadius: 14, borderWidth: 1, gap: 10, padding: 14 },
  candidateRow: { alignItems: 'center', flexDirection: 'row', gap: 12 },
  candidateLabel: { color: '#ffffff', fontSize: 15, fontWeight: '800' },
  chipGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { backgroundColor: '#252525', borderColor: '#383838', borderRadius: 999, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8 },
  chipActive: { backgroundColor: 'rgba(255, 122, 0, 0.14)', borderColor: 'rgba(255, 122, 0, 0.45)' },
  chipText: { color: '#d4d4d4', fontSize: 13, fontWeight: '800' },
  chipTextActive: { color: '#ff7a00' },
  fieldLabel: { color: '#d4d4d4', fontSize: 13, fontWeight: '800', marginBottom: 6, marginTop: 8 },
  input: { backgroundColor: '#252525', borderColor: '#383838', borderRadius: 12, borderWidth: 1, color: '#ffffff', fontSize: 14, fontWeight: '700', paddingHorizontal: 14, paddingVertical: 10 },
  rowErrorText: { color: '#ff6b6b', fontSize: 13, fontWeight: '700' },
  rowActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'flex-end' },
  secondaryButton: { backgroundColor: '#252525', borderColor: '#343434', borderRadius: 14, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 12 },
  secondaryButtonText: { color: '#d4d4d4', fontSize: 13, fontWeight: '900' },
  primaryButton: { backgroundColor: '#ff7a00', borderRadius: 14, paddingHorizontal: 18, paddingVertical: 12 },
  primaryButtonText: { color: '#111111', fontSize: 13, fontWeight: '900' },
});
