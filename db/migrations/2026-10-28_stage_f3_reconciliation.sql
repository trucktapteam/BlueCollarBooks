-- Stage F3: reconciliation DIAGNOSES disagreement between the books and the bank. It only reads.
-- It never posts, adjusts, plugs or "balances" anything, and it has no write path at all (views only).
--
-- For each connected bank account / card (after its starting-balance date):
--   books balance  - bank-reported balance  =  difference
-- The difference is then split into what we can point to:
--   * bank transactions not yet recorded in the books        (the bank has them, the books do not)
--   * bank transactions you chose to ignore                    (same, on purpose)
--   * recorded items with no matching bank transaction         (the books have them, the bank feed does not)
-- and whatever is left is reported as UNEXPLAINED. Pending transactions are shown but not in the equation
-- (the bank's "current" balance does not include them). Transactions dated on/before the starting balance date
-- are already inside the starting balance and are only counted for information.
--
-- Effect on an account's balance: a bank account (asset) goes up with money in; a credit card (liability, "amount owed")
-- goes up with purchases. Plaid sign: amount < 0 = money in / card payment; amount > 0 = money out / card purchase.

create or replace view public.reconciliation_unlinked_items with (security_invoker = true) as
with acct as (
  select a.id as account_id, a.user_id, a.type, a.name
    from public.accounts a
    join public.bank_accounts b on b.id = a.bank_account_id and b.user_id = a.user_id
   where a.system_key is null and b.plaid_account_id is not null
), lines as (
  select ac.account_id, ac.user_id, ac.name as account_name, e.source_type, e.source_id, e.entry_date, e.reverses_entry_id, e.memo,
         case when ac.type = 'asset' then l.debit_cents - l.credit_cents else l.credit_cents - l.debit_cents end as effect_cents
    from acct ac
    join public.journal_lines l on l.account_id = ac.account_id
    join public.journal_entries e on e.id = l.entry_id
   where e.source_type <> 'opening_balance'
), linked as (
  select a2.id as account_id,
         case m.kind when 'loan_received' then 'loan' else m.kind end as source_type,
         coalesce(m.expense_id, m.payment_id::text, m.owner_transaction_id::text, m.transfer_id::text, m.loan_id::text, m.loan_payment_id::text, m.refund_id::text) as source_id
    from public.bank_matches m
    join public.plaid_transactions t on t.id = m.plaid_transaction_id and t.user_id = m.user_id
    join public.bank_accounts b on b.user_id = t.user_id and b.plaid_account_id = t.plaid_account_id
    join public.accounts a2 on a2.bank_account_id = b.id and a2.user_id = b.user_id
   where m.undone_at is null
), grouped as (
  select ln.account_id, ln.user_id, ln.account_name, ln.source_type, ln.source_id,
         max(ln.entry_date) filter (where ln.reverses_entry_id is null) as entry_date,
         max(ln.memo) filter (where ln.reverses_entry_id is null) as memo,
         sum(ln.effect_cents)::bigint as effect_cents
    from lines ln
   where not exists (select 1 from linked k where k.account_id = ln.account_id and k.source_type = ln.source_type and k.source_id = ln.source_id)
   group by ln.account_id, ln.user_id, ln.account_name, ln.source_type, ln.source_id
  having sum(ln.effect_cents) <> 0
)
select g.account_id, g.user_id, g.account_name, g.source_type, g.source_id, g.entry_date, g.memo, g.effect_cents,
       (ob.as_of is null or g.entry_date > ob.as_of) as after_start
  from grouped g
  left join public.opening_balances ob on ob.account_id = g.account_id;
revoke all on public.reconciliation_unlinked_items from public, anon, authenticated;
grant select on public.reconciliation_unlinked_items to authenticated;

create or replace view public.reconciliation_accounts with (security_invoker = true) as
with acct as (
  select a.id as account_id, a.user_id, a.type, a.name, b.balance as bank_balance_cents, b.last_updated as bank_balance_as_of, b.plaid_account_id, b.needs_reauth
    from public.accounts a
    join public.bank_accounts b on b.id = a.bank_account_id and b.user_id = a.user_id
   where a.system_key is null and b.plaid_account_id is not null
), feed as (
  select ac.account_id, t.date, t.pending, t.excluded,
         case when ac.type = 'asset' then -t.amount else t.amount end as effect_cents,
         (m.id is not null) as matched
    from acct ac
    join public.plaid_transactions t on t.user_id = ac.user_id and t.plaid_account_id = ac.plaid_account_id and t.status = 'active'
    left join public.bank_matches m on m.user_id = t.user_id and m.plaid_transaction_id = t.id and m.undone_at is null
), sums as (
  select ac.account_id,
    count(*) filter (where f.date <= coalesce(ob.as_of, '0001-01-01')) as before_start_count,
    count(*) filter (where f.pending and f.date > coalesce(ob.as_of, '0001-01-01')) as pending_count,
    coalesce(sum(f.effect_cents) filter (where f.pending and f.date > coalesce(ob.as_of, '0001-01-01')), 0)::bigint as pending_cents,
    count(*) filter (where not f.pending and not f.excluded and not f.matched and f.date > coalesce(ob.as_of, '0001-01-01')) as unrecorded_count,
    coalesce(sum(f.effect_cents) filter (where not f.pending and not f.excluded and not f.matched and f.date > coalesce(ob.as_of, '0001-01-01')), 0)::bigint as unrecorded_cents,
    count(*) filter (where not f.pending and f.excluded and not f.matched and f.date > coalesce(ob.as_of, '0001-01-01')) as ignored_count,
    coalesce(sum(f.effect_cents) filter (where not f.pending and f.excluded and not f.matched and f.date > coalesce(ob.as_of, '0001-01-01')), 0)::bigint as ignored_cents
    from acct ac
    left join public.opening_balances ob on ob.account_id = ac.account_id
    left join feed f on f.account_id = ac.account_id
   group by ac.account_id
), unl as (
  select u.account_id, count(*) as unlinked_count, sum(u.effect_cents)::bigint as unlinked_cents
    from public.reconciliation_unlinked_items u where u.after_start group by u.account_id
), base as (
  select ac.account_id, ac.user_id, ac.name as account_name, ac.type as account_type, ac.bank_balance_cents, ac.bank_balance_as_of, ac.needs_reauth,
         bal.balance_cents as books_balance_cents, ob.amount_cents as starting_balance_cents, ob.as_of as starting_as_of,
         s.before_start_count, s.pending_count, s.pending_cents, s.unrecorded_count, s.unrecorded_cents, s.ignored_count, s.ignored_cents,
         coalesce(u.unlinked_count, 0) as unlinked_count, coalesce(u.unlinked_cents, 0)::bigint as unlinked_cents
    from acct ac
    join public.account_balances bal on bal.account_id = ac.account_id
    join sums s on s.account_id = ac.account_id
    left join public.opening_balances ob on ob.account_id = ac.account_id
    left join unl u on u.account_id = ac.account_id
)
select b.*,
       (b.books_balance_cents - b.bank_balance_cents) as difference_cents,
       (-(b.unrecorded_cents + b.ignored_cents) + b.unlinked_cents) as explained_cents,
       case when b.starting_as_of is null then null
            else (b.books_balance_cents - b.bank_balance_cents) - (-(b.unrecorded_cents + b.ignored_cents) + b.unlinked_cents) end as unexplained_cents,
       case when b.starting_as_of is null then 'needs_starting_balance'
            when (b.books_balance_cents - b.bank_balance_cents) - (-(b.unrecorded_cents + b.ignored_cents) + b.unlinked_cents) <> 0 then 'unexplained'
            when b.unrecorded_count + b.ignored_count + b.unlinked_count > 0 then 'explained_by_open_items'
            else 'agrees' end as status
  from base b;
revoke all on public.reconciliation_accounts from public, anon, authenticated;
grant select on public.reconciliation_accounts to authenticated;
