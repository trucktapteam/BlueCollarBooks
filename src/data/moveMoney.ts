import { supabase } from '@/lib/supabase';

// Thin wrappers over the database functions that record money moving between
// the owner's own places. Each call is ONE database transaction that either
// fully records the event in the books or changes nothing. Every account here
// is a real account the user chose - nothing is guessed.

type Money = { dateISO: string; amountCents: number; notes?: string };

async function call(name: string, args: Record<string, unknown>) {
  const { error } = await supabase.rpc(name, args);
  if (error) {
    console.error(`${name} failed`, error);
    throw error;
  }
}

export function moveBetweenAccounts(input: Money & { fromAccountId: string; toAccountId: string }) {
  return call('record_transfer', {
    p_date: input.dateISO,
    p_amount_cents: input.amountCents,
    p_from_account_id: input.fromAccountId,
    p_to_account_id: input.toAccountId,
    p_notes: input.notes || null,
  });
}

export function payCreditCard(input: Money & { fromAccountId: string; cardAccountId: string }) {
  return call('record_card_payment', {
    p_date: input.dateISO,
    p_amount_cents: input.amountCents,
    p_from_account_id: input.fromAccountId,
    p_card_account_id: input.cardAccountId,
    p_notes: input.notes || null,
  });
}

// "I put money into the business" - deposited to one of the business's accounts.
export function putMoneyIn(input: Money & { depositedToAccountId: string }) {
  return call('record_owner_contribution', {
    p_date: input.dateISO,
    p_amount_cents: input.amountCents,
    p_account_id: input.depositedToAccountId,
    p_notes: input.notes || null,
  });
}

// "I took money out of the business" - paid from one of the business's accounts.
export function takeMoneyOut(input: Money & { paidFromAccountId: string }) {
  return call('record_owner_draw', {
    p_date: input.dateISO,
    p_amount_cents: input.amountCents,
    p_account_id: input.paidFromAccountId,
    p_notes: input.notes || null,
  });
}

export function receiveLoan(
  input: Money & { name: string; lender: string; depositedToAccountId: string; interestRateBps?: number }
) {
  return call('record_loan', {
    p_name: input.name,
    p_lender: input.lender,
    p_principal_cents: input.amountCents,
    p_opened_date: input.dateISO,
    p_proceeds_account_id: input.depositedToAccountId,
    p_interest_rate_bps: input.interestRateBps ?? null,
    p_notes: input.notes || null,
  });
}

export function payLoan(input: {
  loanId: string;
  dateISO: string;
  principalCents: number;
  interestCents: number;
  paidFromAccountId: string;
  notes?: string;
}) {
  return call('record_loan_payment', {
    p_loan_id: input.loanId,
    p_date: input.dateISO,
    p_principal_cents: input.principalCents,
    p_interest_cents: input.interestCents,
    p_paid_from_account_id: input.paidFromAccountId,
    p_notes: input.notes || null,
  });
}

export type EquipmentFunding =
  | { kind: 'account'; accountId: string; amountCents: number }
  | { kind: 'owner'; amountCents: number }
  | { kind: 'loan'; name: string; lender: string; amountCents: number; interestRateBps?: number };

// One piece of equipment bought with one or more sources of money (bank,
// card, your own pocket, financing). One purchase, recorded once.
export function buyEquipment(input: { name: string; dateISO: string; costCents: number; funding: EquipmentFunding[]; notes?: string }) {
  return call('record_equipment', {
    p_name: input.name,
    p_date: input.dateISO,
    p_cost_cents: input.costCents,
    p_funding: input.funding.map((source) =>
      source.kind === 'account'
        ? { kind: 'account', account_id: source.accountId, amount_cents: source.amountCents }
        : source.kind === 'owner'
          ? { kind: 'owner', amount_cents: source.amountCents }
          : {
              kind: 'loan',
              name: source.name,
              lender: source.lender,
              amount_cents: source.amountCents,
              interest_rate_bps: source.interestRateBps ?? null,
            }
    ),
    p_notes: input.notes || null,
  });
}

export type OpenLoan = { id: string; name: string; lender: string | null };

export async function loadOpenLoans(userId: string): Promise<OpenLoan[]> {
  const { data, error } = await supabase
    .from('loans')
    .select('id, name, lender')
    .eq('user_id', userId)
    .is('voided_at', null)
    .order('name', { ascending: true });
  if (error) {
    console.error('Failed to load loans', error);
    return [];
  }
  return (data ?? []) as OpenLoan[];
}

// ----- recent money activity: look back, correct, undo -----
// Every correction is one database function. Editing or voiding reverses what
// was recorded and records the corrected version; nothing is overwritten.

export type ActivityKind =
  | 'transfer'
  | 'card_payment'
  | 'owner_draw'
  | 'owner_contribution'
  | 'loan_received'
  | 'loan_payment'
  | 'refund'
  | 'equipment'
  | 'customer_payment';

export type MoneyActivity = {
  id: string;
  kind: ActivityKind;
  dateISO: string;
  amountCents: number;
  label: string | null;
  accountId: string | null;
  otherAccountId: string | null;
  notes: string | null;
  interestCents: number | null;
  loanId: string | null;
  category: string | null;
  voided: boolean;
  bankLinked: boolean;
};

type ActivityRow = {
  id: string;
  kind: ActivityKind;
  event_date: string;
  amount_cents: number;
  label: string | null;
  account_id: string | null;
  other_account_id: string | null;
  notes: string | null;
  interest_cents: number | null;
  loan_id: string | null;
  category: string | null;
  voided_at: string | null;
  bank_linked: boolean;
};

export async function loadMoneyActivity(userId: string): Promise<MoneyActivity[]> {
  const { data, error } = await supabase
    .from('money_activity')
    .select('*')
    .eq('user_id', userId)
    .order('event_date', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) {
    console.error('Failed to load money activity', error);
    return [];
  }
  return ((data ?? []) as ActivityRow[]).map((row) => ({
    id: row.id,
    kind: row.kind,
    dateISO: row.event_date,
    amountCents: row.amount_cents,
    label: row.label,
    accountId: row.account_id,
    otherAccountId: row.other_account_id,
    notes: row.notes,
    interestCents: row.interest_cents,
    loanId: row.loan_id,
    category: row.category,
    voided: row.voided_at !== null,
    bankLinked: row.bank_linked,
  }));
}

// Takes it back out of the books. If it was matched to a bank transaction, that
// transaction returns to review.
export function voidActivity(activity: Pick<MoneyActivity, 'id' | 'kind'>) {
  switch (activity.kind) {
    case 'transfer':
    case 'card_payment':
      return call('void_transfer', { p_id: activity.id });
    case 'owner_draw':
    case 'owner_contribution':
      return call('void_owner_transaction', { p_id: activity.id });
    case 'loan_received':
      return call('void_loan', { p_id: activity.id });
    case 'loan_payment':
      return call('void_loan_payment', { p_id: activity.id });
    case 'refund':
      return call('void_refund', { p_id: activity.id });
    case 'equipment':
      return call('void_fixed_asset', { p_id: activity.id });
    case 'customer_payment':
      return call('void_payment', { p_payment_id: activity.id });
  }
}

export type ActivityEdit = { dateISO: string; amountCents: number; accountId: string; otherAccountId?: string; interestCents?: number; notes?: string };

// Corrects the date, amount, account or note. Not available for equipment and
// customer payments (void and re-record those).
export function editActivity(activity: MoneyActivity, edit: ActivityEdit) {
  const notes = edit.notes?.trim() || null;
  switch (activity.kind) {
    case 'transfer':
    case 'card_payment':
      return call('update_transfer', {
        p_id: activity.id,
        p_date: edit.dateISO,
        p_amount_cents: edit.amountCents,
        p_from_account_id: edit.accountId,
        p_to_account_id: edit.otherAccountId,
        p_notes: notes,
      });
    case 'owner_draw':
    case 'owner_contribution':
      return call('update_owner_transaction', {
        p_id: activity.id,
        p_date: edit.dateISO,
        p_amount_cents: edit.amountCents,
        p_account_id: edit.accountId,
        p_notes: notes,
      });
    case 'refund':
      return call('update_refund', {
        p_id: activity.id,
        p_date: edit.dateISO,
        p_amount_cents: edit.amountCents,
        p_account_id: edit.accountId,
        p_category: activity.category === 'Uncategorized Expense' ? null : activity.category,
        p_notes: notes,
      });
    case 'loan_payment': {
      const interest = edit.interestCents ?? activity.interestCents ?? 0;
      return call('update_loan_payment', {
        p_id: activity.id,
        p_date: edit.dateISO,
        p_principal_cents: edit.amountCents - interest,
        p_interest_cents: interest,
        p_paid_from_account_id: edit.accountId,
        p_notes: notes,
      });
    }
    default:
      throw new Error('This kind of entry cannot be edited. Void it and record it again.');
  }
}
