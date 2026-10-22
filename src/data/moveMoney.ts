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
