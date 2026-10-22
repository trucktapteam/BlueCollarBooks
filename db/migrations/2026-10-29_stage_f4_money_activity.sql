-- Stage F4 (applied as migration "stage_f4_money_activity"): one list of money events the user can correct.
-- Read-only view; corrections go through the existing update_*/void_* functions (reversal/repost underneath).
create or replace view public.money_activity with (security_invoker = true) as
select t.id::text as id, t.user_id, t.kind, t.transfer_date as event_date, t.amount_cents, null::text as label,
       t.from_account_id as account_id, t.to_account_id as other_account_id, t.notes, null::bigint as interest_cents,
       null::uuid as loan_id, null::text as category, t.voided_at, t.created_at,
       exists (select 1 from public.bank_matches m where m.user_id = t.user_id and m.undone_at is null and m.transfer_id = t.id) as bank_linked
  from public.transfers t
union all
select o.id::text, o.user_id, case o.kind when 'draw' then 'owner_draw' else 'owner_contribution' end, o.txn_date, o.amount_cents, null,
       o.account_id, null, o.notes, null, null, null, o.voided_at, o.created_at,
       exists (select 1 from public.bank_matches m where m.user_id = o.user_id and m.undone_at is null and m.owner_transaction_id = o.id)
  from public.owner_transactions o
union all
select l.id::text, l.user_id, 'loan_received', l.opened_date, l.principal_cents, l.name,
       l.proceeds_account_id, null, l.notes, null, l.id, null, l.voided_at, l.created_at,
       exists (select 1 from public.bank_matches m where m.user_id = l.user_id and m.undone_at is null and m.loan_id = l.id)
  from public.loans l where l.origin = 'cash'
union all
select p.id::text, p.user_id, 'loan_payment', p.payment_date, p.principal_cents + p.interest_cents, (select ln.name from public.loans ln where ln.id = p.loan_id),
       p.paid_from_account_id, null, p.notes, p.interest_cents, p.loan_id, null, p.voided_at, p.created_at,
       exists (select 1 from public.bank_matches m where m.user_id = p.user_id and m.undone_at is null and m.loan_payment_id = p.id)
  from public.loan_payments p
union all
select r.id::text, r.user_id, 'refund', r.refund_date, r.amount_cents, null,
       r.account_id, null, r.notes, null, null, (select a.name from public.accounts a where a.id = r.expense_account_id), r.voided_at, r.created_at,
       exists (select 1 from public.bank_matches m where m.user_id = r.user_id and m.undone_at is null and m.refund_id = r.id)
  from public.refunds r
union all
select f.id::text, f.user_id, 'equipment', f.acquired_date, f.cost_cents, f.name,
       null, null, null, null, null, null, f.voided_at, f.created_at, false
  from public.fixed_assets f
union all
select y.id::text, y.user_id, 'customer_payment', y.payment_date, y.amount_cents, (select c.name from public.customers c where c.id = y.customer_id and c.user_id = y.user_id),
       y.deposit_account_id, null, y.notes, null, null, null, y.voided_at, y.created_at,
       exists (select 1 from public.bank_matches m where m.user_id = y.user_id and m.undone_at is null and m.payment_id = y.id)
  from public.payments y;
revoke all on public.money_activity from public, anon, authenticated;
grant select on public.money_activity to authenticated;
