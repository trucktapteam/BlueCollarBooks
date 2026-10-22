-- Stage F2: resolving bank transactions (money out AND money in) against the books.
--
-- Principles
--  * A bank transaction is never "income" or "expense" by itself. It is linked (bank_matches) to ONE accounting event
--    (expense, customer payment, owner draw/contribution, transfer/card payment, loan received/payment, refund).
--  * Matching an event that already exists comes first. Creating a new event while a plausible existing one is
--    unmatched is refused until the user explicitly says "this is a separate one" (confirm_new).
--  * The bank transaction already knows its real account (bank_accounts.plaid_account_id -> accounts.bank_account_id).
--  * Everything is validated in the database at commit (account, amount, direction), and re-validated whenever the
--    linked event is edited; voiding an event releases the link and the bank transaction returns to review.
--  * Pending transactions cannot be recorded yet (they can change or vanish); they can be marked Unsure or Excluded.

-- ===== 1. refunds (money back from a vendor: Dr bank/card, Cr the expense it reduces) =====
alter table public.journal_entries drop constraint journal_entries_source_type_check;
alter table public.journal_entries add constraint journal_entries_source_type_check check (source_type = any (array[
  'invoice','payment','expense','bank_transaction','transfer','loan','loan_payment','owner_draw','owner_contribution','equipment',
  'opening_balance','refund','manual']));

create table public.refunds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  refund_date date not null check (refund_date between '2000-01-01' and '2100-12-31'),
  amount_cents bigint not null check (amount_cents > 0),
  account_id uuid not null,
  expense_account_id uuid not null,
  notes text,
  voided_at timestamptz,
  created_at timestamptz not null default now(),
  constraint refunds_id_user_unique unique (id, user_id),
  constraint refunds_account_owner_fkey foreign key (account_id, user_id) references public.accounts (id, user_id),
  constraint refunds_expense_account_owner_fkey foreign key (expense_account_id, user_id) references public.accounts (id, user_id)
);
alter table public.refunds enable row level security;
create policy refunds_select_own on public.refunds for select to authenticated using (auth.uid() = user_id);
revoke all on public.refunds from public, anon, authenticated;
grant select on public.refunds to authenticated;

create or replace function public._check_refund(p_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.refunds;
begin
  select * into r from public.refunds where id = p_id;
  if not found then return; end if;
  perform public._check_event(r.user_id, 'refund', r.id::text, r.voided_at is null, r.refund_date,
    jsonb_build_object(r.account_id::text, r.amount_cents), jsonb_build_object(r.expense_account_id::text, r.amount_cents));
end $$;

create or replace function public._sync_refund_posting(p_user uuid, p_id uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.refunds; an text; en text;
begin
  select * into r from public.refunds where id = p_id and user_id = p_user;
  if not found then raise exception 'refund not found' using errcode = 'P0002'; end if;
  select name into an from public.accounts where id = r.account_id;
  select name into en from public.accounts where id = r.expense_account_id;
  return public._sync_event(p_user, 'refund', r.id::text, r.voided_at is null, r.refund_date, 'Refund into ' || an || ' (' || en || ')',
    jsonb_build_object(r.account_id::text, r.amount_cents), jsonb_build_object(r.expense_account_id::text, r.amount_cents));
end $$;

create or replace function public._tg_refund_check() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin perform public._check_refund(new.id); return null; end $$;
create constraint trigger refunds_check after insert or update on public.refunds
  deferrable initially deferred for each row execute function public._tg_refund_check();

create or replace function public.refunds_block_delete_when_posted() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from auth.users u where u.id = old.user_id) and public._active_entry(old.user_id, 'refund', old.id::text) is not null then
    raise exception 'refund is posted to the books; void it instead of deleting' using errcode = '23503';
  end if;
  return old;
end $$;
create trigger refunds_block_delete_when_posted before delete on public.refunds
  for each row execute function public.refunds_block_delete_when_posted();

create or replace function public._tg_entry_source_check() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.source_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return null; end if;
  case new.source_type
    when 'payment'            then perform public._check_payment(new.source_id::uuid);
    when 'transfer'           then perform public._check_transfer(new.source_id::uuid);
    when 'owner_draw'         then perform public._check_owner_txn(new.source_id::uuid);
    when 'owner_contribution' then perform public._check_owner_txn(new.source_id::uuid);
    when 'loan'               then perform public._check_loan(new.source_id::uuid);
    when 'loan_payment'       then perform public._check_loan_payment(new.source_id::uuid);
    when 'equipment'          then perform public._check_fixed_asset(new.source_id::uuid);
    when 'refund'             then perform public._check_refund(new.source_id::uuid);
    else null;
  end case;
  return null;
end $$;
drop trigger journal_entries_source_check on public.journal_entries;
create constraint trigger journal_entries_source_check after insert on public.journal_entries
  deferrable initially deferred for each row
  when (new.source_type in ('payment','transfer','owner_draw','owner_contribution','loan','loan_payment','equipment','refund'))
  execute function public._tg_entry_source_check();

create or replace function public._write_refund(p_user uuid, p_id uuid, p_date date, p_amount bigint, p_account uuid, p_category text, p_notes text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare rid uuid := p_id; a public.accounts; ea uuid;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'amount must be greater than zero' using errcode = '23514'; end if;
  if p_date is null then raise exception 'a date is required' using errcode = '23514'; end if;
  select * into a from public.accounts where id = p_account and user_id = p_user;
  if not found or not a.is_active or a.system_key is not null or a.bank_account_id is null or a.type not in ('asset', 'liability') then
    raise exception 'choose the bank account or card the money came back to' using errcode = '23514';
  end if;
  ea := public._expense_account(p_user, p_category);
  if rid is null then
    insert into public.refunds (user_id, refund_date, amount_cents, account_id, expense_account_id, notes)
    values (p_user, p_date, p_amount, p_account, ea, p_notes) returning id into rid;
  else
    update public.refunds set refund_date = p_date, amount_cents = p_amount, account_id = p_account, expense_account_id = ea, notes = p_notes where id = rid;
  end if;
  perform public._sync_refund_posting(p_user, rid);
  return rid;
end $$;

create or replace function public.record_refund(p_date date, p_amount_cents bigint, p_account_id uuid, p_category text default null, p_notes text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'not signed in' using errcode = '28000'; end if;
  perform public.seed_chart_of_accounts(u);
  return public._write_refund(u, null, p_date, p_amount_cents, p_account_id, p_category, p_notes);
end $$;

create or replace function public.update_refund(p_id uuid, p_date date, p_amount_cents bigint, p_account_id uuid, p_category text default null, p_notes text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := auth.uid(); r public.refunds;
begin
  if u is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select * into r from public.refunds where id = p_id and user_id = u for update;
  if not found then raise exception 'refund not found' using errcode = 'P0002'; end if;
  if r.voided_at is not null then raise exception 'a voided refund cannot be edited' using errcode = '23514'; end if;
  return public._write_refund(u, r.id, p_date, p_amount_cents, p_account_id, p_category, p_notes);
end $$;

create or replace function public.void_refund(p_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := auth.uid(); r public.refunds;
begin
  if u is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select * into r from public.refunds where id = p_id and user_id = u for update;
  if not found then raise exception 'refund not found' using errcode = 'P0002'; end if;
  if r.voided_at is not null then return; end if;
  update public.refunds set voided_at = now() where id = r.id;
  perform public._sync_refund_posting(u, r.id);
end $$;

-- ===== 2. bank_matches: which accounting event a bank transaction is =====
create table public.bank_matches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plaid_transaction_id text not null,
  kind text not null check (kind in ('expense','payment','owner_draw','owner_contribution','transfer','loan_received','loan_payment','refund')),
  side text check (side in ('from', 'to')),
  created_event boolean not null default false,          -- true: this bank transaction created the event (undo voids it too)
  expense_id text,
  payment_id uuid,
  owner_transaction_id uuid,
  transfer_id uuid,
  loan_id uuid,
  loan_payment_id uuid,
  refund_id uuid,
  created_at timestamptz not null default now(),
  undone_at timestamptz,
  undone_reason text,
  constraint bank_matches_id_user_unique unique (id, user_id),
  constraint bank_matches_txn_fkey foreign key (plaid_transaction_id, user_id) references public.plaid_transactions (id, user_id),
  constraint bank_matches_expense_fkey foreign key (expense_id, user_id) references public.expenses (id, user_id),
  constraint bank_matches_payment_fkey foreign key (payment_id, user_id) references public.payments (id, user_id),
  constraint bank_matches_owner_fkey foreign key (owner_transaction_id, user_id) references public.owner_transactions (id, user_id),
  constraint bank_matches_transfer_fkey foreign key (transfer_id, user_id) references public.transfers (id, user_id),
  constraint bank_matches_loan_fkey foreign key (loan_id, user_id) references public.loans (id, user_id),
  constraint bank_matches_loan_payment_fkey foreign key (loan_payment_id, user_id) references public.loan_payments (id, user_id),
  constraint bank_matches_refund_fkey foreign key (refund_id, user_id) references public.refunds (id, user_id),
  constraint bank_matches_one_target check (
    (expense_id is not null)::int + (payment_id is not null)::int + (owner_transaction_id is not null)::int + (transfer_id is not null)::int
    + (loan_id is not null)::int + (loan_payment_id is not null)::int + (refund_id is not null)::int = 1),
  constraint bank_matches_kind_target check (
    (kind = 'expense' and expense_id is not null and side is null) or
    (kind = 'payment' and payment_id is not null and side is null) or
    (kind in ('owner_draw', 'owner_contribution') and owner_transaction_id is not null and side is null) or
    (kind = 'transfer' and transfer_id is not null and side is not null) or
    (kind = 'loan_received' and loan_id is not null and side is null) or
    (kind = 'loan_payment' and loan_payment_id is not null and side is null) or
    (kind = 'refund' and refund_id is not null and side is null)),
  constraint bank_matches_undone_reason check (undone_at is not null or undone_reason is null)
);
-- one live link per bank transaction, and one live link per event (a transfer has two sides)
create unique index bank_matches_txn_live on public.bank_matches (plaid_transaction_id) where undone_at is null;
create unique index bank_matches_expense_live on public.bank_matches (expense_id) where undone_at is null and expense_id is not null;
create unique index bank_matches_payment_live on public.bank_matches (payment_id) where undone_at is null and payment_id is not null;
create unique index bank_matches_owner_live on public.bank_matches (owner_transaction_id) where undone_at is null and owner_transaction_id is not null;
create unique index bank_matches_transfer_live on public.bank_matches (transfer_id, side) where undone_at is null and transfer_id is not null;
create unique index bank_matches_loan_live on public.bank_matches (loan_id) where undone_at is null and loan_id is not null;
create unique index bank_matches_loan_payment_live on public.bank_matches (loan_payment_id) where undone_at is null and loan_payment_id is not null;
create unique index bank_matches_refund_live on public.bank_matches (refund_id) where undone_at is null and refund_id is not null;
create index bank_matches_user_idx on public.bank_matches (user_id);
alter table public.bank_matches enable row level security;
create policy bank_matches_select_own on public.bank_matches for select to authenticated using (auth.uid() = user_id);
revoke all on public.bank_matches from public, anon, authenticated;
grant select on public.bank_matches to authenticated;

-- the books account a bank transaction belongs to (its real connected account)
create or replace function public._bank_txn_account(p_user uuid, p_plaid_account text)
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select a.id from public.bank_accounts b join public.accounts a on a.bank_account_id = b.id and a.user_id = p_user
   where b.user_id = p_user and b.plaid_account_id = p_plaid_account $$;

-- THE rule: why a link is (not) valid. null = valid; 'voided' = the linked event was voided.
create or replace function public._match_problem(m public.bank_matches)
returns text language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  t public.plaid_transactions; acct uuid; amt bigint;
  e_acct uuid; e_amt bigint; e_sign int; e_void boolean := false;
  x public.expenses; py public.payments; ow public.owner_transactions; tr public.transfers; ln public.loans; lp public.loan_payments; rf public.refunds;
begin
  select * into t from public.plaid_transactions where id = m.plaid_transaction_id and user_id = m.user_id;
  if not found then return 'the bank transaction does not exist'; end if;
  if t.status <> 'active' then return 'the bank transaction is no longer in your bank feed'; end if;
  acct := public._bank_txn_account(m.user_id, t.plaid_account_id);
  if acct is null then return 'this bank transaction''s account is not set up in your books'; end if;
  amt := abs(t.amount)::bigint;

  case m.kind
    when 'expense' then
      select * into x from public.expenses where id = m.expense_id and user_id = m.user_id;
      if not found then return 'the expense no longer exists'; end if;
      select jl.account_id into e_acct from public.journal_lines jl
       where jl.entry_id = public._active_entry(m.user_id, 'expense', x.id) and jl.credit_cents > 0 limit 1;
      e_amt := x.amount; e_sign := 1;
    when 'payment' then
      select * into py from public.payments where id = m.payment_id and user_id = m.user_id;
      e_acct := py.deposit_account_id; e_amt := py.amount_cents; e_sign := -1; e_void := py.voided_at is not null;
    when 'owner_draw', 'owner_contribution' then
      select * into ow from public.owner_transactions where id = m.owner_transaction_id and user_id = m.user_id;
      if (m.kind = 'owner_draw') <> (ow.kind = 'draw') then return 'this is not that kind of owner transaction'; end if;
      e_acct := ow.account_id; e_amt := ow.amount_cents; e_sign := case ow.kind when 'draw' then 1 else -1 end; e_void := ow.voided_at is not null;
    when 'transfer' then
      select * into tr from public.transfers where id = m.transfer_id and user_id = m.user_id;
      e_amt := tr.amount_cents; e_void := tr.voided_at is not null;
      if m.side = 'from' then e_acct := tr.from_account_id; e_sign := 1; else e_acct := tr.to_account_id; e_sign := -1; end if;
    when 'loan_received' then
      select * into ln from public.loans where id = m.loan_id and user_id = m.user_id;
      e_acct := ln.proceeds_account_id; e_amt := ln.principal_cents; e_sign := -1; e_void := ln.voided_at is not null;
    when 'loan_payment' then
      select * into lp from public.loan_payments where id = m.loan_payment_id and user_id = m.user_id;
      e_acct := lp.paid_from_account_id; e_amt := lp.principal_cents + lp.interest_cents; e_sign := 1; e_void := lp.voided_at is not null;
    when 'refund' then
      select * into rf from public.refunds where id = m.refund_id and user_id = m.user_id;
      e_acct := rf.account_id; e_amt := rf.amount_cents; e_sign := -1; e_void := rf.voided_at is not null;
  end case;

  if e_void then return 'voided'; end if;
  if sign(t.amount) <> e_sign then
    return case when e_sign = 1 then 'that item is money going out but the bank shows money coming in' else 'that item is money coming in but the bank shows money going out' end;
  end if;
  if e_acct is distinct from acct then return 'that item is for a different account than the bank transaction'; end if;
  if e_amt is distinct from amt then return 'that item is a different amount than the bank transaction'; end if;
  return null;
end $$;

create or replace function public._tg_bank_match_check() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare m public.bank_matches; p text;
begin
  select * into m from public.bank_matches where id = new.id;
  if not found or m.undone_at is not null then return null; end if;
  p := public._match_problem(m);
  if p = 'voided' then
    update public.bank_matches set undone_at = now(), undone_reason = 'The recorded item was voided.' where id = m.id;
  elsif p is not null then
    raise exception 'bank link is not valid: %', p using errcode = '23514';
  end if;
  return null;
end $$;
create constraint trigger bank_matches_check after insert or update on public.bank_matches
  deferrable initially deferred for each row execute function public._tg_bank_match_check();

-- Changing a linked event must keep its link valid. Voiding it releases the link (the bank transaction returns to review).
create or replace function public._tg_revalidate_matches() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare m public.bank_matches; p text; mcol text := tg_argv[0]; rid text := to_jsonb(new)->>'id';
begin
  for m in select b.* from public.bank_matches b where b.user_id = new.user_id and b.undone_at is null and to_jsonb(b)->>mcol = rid loop
    p := public._match_problem(m);
    if p = 'voided' then
      update public.bank_matches set undone_at = now(), undone_reason = 'The recorded item was voided.' where id = m.id;
    elsif p is not null then
      raise exception 'This change would break the link to its bank transaction (%). Remove the bank link first, or keep the account and amount the same.', p using errcode = '23514';
    end if;
  end loop;
  return null;
end $$;
create constraint trigger expenses_match_check after update on public.expenses deferrable initially deferred for each row execute function public._tg_revalidate_matches('expense_id');
create constraint trigger payments_match_check after update on public.payments deferrable initially deferred for each row execute function public._tg_revalidate_matches('payment_id');
create constraint trigger owner_transactions_match_check after update on public.owner_transactions deferrable initially deferred for each row execute function public._tg_revalidate_matches('owner_transaction_id');
create constraint trigger transfers_match_check after update on public.transfers deferrable initially deferred for each row execute function public._tg_revalidate_matches('transfer_id');
create constraint trigger loans_match_check after update on public.loans deferrable initially deferred for each row execute function public._tg_revalidate_matches('loan_id');
create constraint trigger loan_payments_match_check after update on public.loan_payments deferrable initially deferred for each row execute function public._tg_revalidate_matches('loan_payment_id');
create constraint trigger refunds_match_check after update on public.refunds deferrable initially deferred for each row execute function public._tg_revalidate_matches('refund_id');

-- ===== 3. the bank transaction's own state, replacing the old expense_id/category columns =====
do $$
declare r record; mid uuid;
begin
  for r in select id, user_id, expense_id from public.plaid_transactions where expense_id is not null and status = 'active' loop
    insert into public.bank_matches (user_id, plaid_transaction_id, kind, expense_id, created_event) values (r.user_id, r.id, 'expense', r.expense_id, true) returning id into mid;
    if public._match_problem((select m from public.bank_matches m where m.id = mid)) is not null then delete from public.bank_matches where id = mid; end if;
  end loop;
end $$;
alter table public.plaid_transactions drop column expense_id, drop column category;

create or replace view public.bank_feed with (security_invoker = true) as
select t.id, t.user_id, t.date, t.name, t.merchant_name, t.amount, t.pending, t.plaid_category, t.plaid_account_id,
       t.excluded, t.review_state, t.review_note,
       a.id as account_id, a.name as account_name, a.type as account_type,
       m.id as match_id, m.kind as match_kind, m.side as match_side, m.created_event as match_created_event,
       coalesce(m.expense_id, m.payment_id::text, m.owner_transaction_id::text, m.transfer_id::text, m.loan_id::text, m.loan_payment_id::text, m.refund_id::text) as match_target,
       case when m.id is not null then 'recorded' when t.excluded then 'excluded' when t.review_state = 'unsure' then 'unsure'
            when t.pending then 'pending' else 'needs_review' end as state
  from public.plaid_transactions t
  left join public.bank_accounts b on b.user_id = t.user_id and b.plaid_account_id = t.plaid_account_id
  left join public.accounts a on a.user_id = t.user_id and a.bank_account_id = b.id
  left join public.bank_matches m on m.user_id = t.user_id and m.plaid_transaction_id = t.id and m.undone_at is null
 where t.status = 'active';
revoke all on public.bank_feed from public, anon, authenticated;
grant select on public.bank_feed to authenticated;

-- ===== 4. pending -> posted and removal now carry / release links =====
create or replace function public._release_match(p_user uuid, p_txn text, p_reason text)
returns void language sql security definer set search_path = public, pg_temp as $$
  update public.bank_matches set undone_at = now(), undone_reason = p_reason where user_id = p_user and plaid_transaction_id = p_txn and undone_at is null $$;

create or replace function public._supersede_pending(p_user uuid, p_pending text, p_posted text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.plaid_transactions; x public.plaid_transactions; m public.bank_matches; prob text;
begin
  if p_pending is null or p_pending = p_posted then return; end if;
  select * into p from public.plaid_transactions where id = p_pending and user_id = p_user for update;
  if not found then return; end if;
  select * into x from public.plaid_transactions where id = p_posted and user_id = p_user for update;
  if not found then return; end if;
  if p.status = 'superseded' and p.superseded_by = p_posted then return; end if;

  -- whatever else the user already decided travels to the posted row
  update public.plaid_transactions set
      excluded = x.excluded or p.excluded,
      review_state = case when x.review_state = 'unsure' or p.review_state = 'unsure' then 'unsure' else 'open' end,
      review_note = coalesce(x.review_note, p.review_note)
   where id = x.id;
  -- a link made on the pending row moves to the posted row if it is still valid there (same account and amount), else it is released
  select * into m from public.bank_matches where plaid_transaction_id = p.id and user_id = p_user and undone_at is null;
  if found then
    if exists (select 1 from public.bank_matches where plaid_transaction_id = x.id and user_id = p_user and undone_at is null) then
      update public.bank_matches set undone_at = now(), undone_reason = 'The final bank transaction was already recorded.' where id = m.id;
    else
      update public.bank_matches set plaid_transaction_id = x.id where id = m.id;
      prob := public._match_problem((select b from public.bank_matches b where b.id = m.id));
      if prob is not null then
        update public.bank_matches set undone_at = now(), undone_reason = 'The final amount or account differs from the pending one (' || prob || ').' where id = m.id;
        update public.plaid_transactions set review_note = coalesce(review_note, 'The final amount differs from the pending one; check what you recorded earlier.') where id = x.id;
      end if;
    end if;
  end if;

  update public.plaid_transactions set status = 'superseded', superseded_by = x.id, excluded = false, review_state = 'open', updated_at = now()
   where id = p.id;
end $$;

create or replace function public._remove_plaid_txn(p_user uuid, p_id text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.plaid_transactions; x text;
begin
  select * into p from public.plaid_transactions where id = p_id and user_id = p_user for update;
  if not found or p.status <> 'active' then return; end if;
  select id into x from public.plaid_transactions where user_id = p_user and pending_transaction_id = p.id and status = 'active' limit 1;
  if x is not null then perform public._supersede_pending(p_user, p.id, x); return; end if;
  -- the bank took it back: release the link; whatever was recorded stays in the books and shows up in reconciliation
  perform public._release_match(p_user, p.id, 'The bank removed this transaction. What you recorded is still in your books.');
  update public.plaid_transactions set status = 'removed', updated_at = now() where id = p.id;
end $$;

create or replace function public.exclude_bank_transaction(p_id text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := auth.uid(); t public.plaid_transactions;
begin
  if u is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select * into t from public.plaid_transactions where id = p_id and user_id = u for update;
  if not found then raise exception 'transaction not found' using errcode = 'P0002'; end if;
  if t.status <> 'active' then raise exception 'this transaction is no longer in your bank feed' using errcode = '23514'; end if;
  if exists (select 1 from public.bank_matches where plaid_transaction_id = t.id and user_id = u and undone_at is null) then
    raise exception 'this transaction is already recorded; undo that first' using errcode = '23514';
  end if;
  update public.plaid_transactions set excluded = true, review_state = 'open', updated_at = now() where id = t.id;
end $$;

-- "Put back in review": clears Excluded and Unsure
create or replace function public.restore_bank_transaction(p_id text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := auth.uid(); t public.plaid_transactions;
begin
  if u is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select * into t from public.plaid_transactions where id = p_id and user_id = u for update;
  if not found then raise exception 'transaction not found' using errcode = 'P0002'; end if;
  update public.plaid_transactions set excluded = false, review_state = 'open', review_note = null, updated_at = now() where id = t.id;
end $$;

-- ===== 5. suggestions: existing events first =====
create or replace function public._bank_candidates(p_user uuid, t public.plaid_transactions)
returns table (kind text, target_id text, side text, label text, event_date date, amount_cents bigint, day_diff int)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare acct uuid := public._bank_txn_account(p_user, t.plaid_account_id); amt bigint := abs(t.amount)::bigint;
begin
  if acct is null then return; end if;
  if t.amount > 0 then
    return query
    select 'expense'::text, x.id, null::text, coalesce(nullif(x.vendor, ''), 'Expense') || coalesce(' - ' || nullif(btrim(x.notes), ''), ''), x.date, x.amount::bigint, abs(x.date - t.date)
      from public.expenses x
     where x.user_id = p_user and x.amount = t.amount and abs(x.date - t.date) <= 14
       and (select jl.account_id from public.journal_lines jl where jl.entry_id = public._active_entry(p_user, 'expense', x.id) and jl.credit_cents > 0 limit 1) = acct
       and not exists (select 1 from public.bank_matches m where m.user_id = p_user and m.undone_at is null and m.expense_id = x.id)
    union all
    select 'owner_draw', o.id::text, null, 'Owner took money out', o.txn_date, o.amount_cents, abs(o.txn_date - t.date)
      from public.owner_transactions o
     where o.user_id = p_user and o.kind = 'draw' and o.voided_at is null and o.account_id = acct and o.amount_cents = amt and abs(o.txn_date - t.date) <= 14
       and not exists (select 1 from public.bank_matches m where m.user_id = p_user and m.undone_at is null and m.owner_transaction_id = o.id)
    union all
    select 'loan_payment', l.id::text, null, 'Loan payment', l.payment_date, l.principal_cents + l.interest_cents, abs(l.payment_date - t.date)
      from public.loan_payments l
     where l.user_id = p_user and l.voided_at is null and l.paid_from_account_id = acct and l.principal_cents + l.interest_cents = amt and abs(l.payment_date - t.date) <= 14
       and not exists (select 1 from public.bank_matches m where m.user_id = p_user and m.undone_at is null and m.loan_payment_id = l.id)
    union all
    select 'transfer', r.id::text, 'from', case r.kind when 'card_payment' then 'Card payment' else 'Transfer' end || ' to ' || (select name from public.accounts where id = r.to_account_id),
           r.transfer_date, r.amount_cents, abs(r.transfer_date - t.date)
      from public.transfers r
     where r.user_id = p_user and r.voided_at is null and r.from_account_id = acct and r.amount_cents = amt and abs(r.transfer_date - t.date) <= 14
       and not exists (select 1 from public.bank_matches m where m.user_id = p_user and m.undone_at is null and m.transfer_id = r.id and m.side = 'from');
  else
    return query
    select 'payment'::text, p.id::text, null::text, 'Payment from ' || coalesce((select c.name from public.customers c where c.id = p.customer_id and c.user_id = p_user), 'a customer'),
           p.payment_date, p.amount_cents, abs(p.payment_date - t.date)
      from public.payments p
     where p.user_id = p_user and p.voided_at is null and p.deposit_account_id = acct and p.amount_cents = amt and abs(p.payment_date - t.date) <= 14
       and not exists (select 1 from public.bank_matches m where m.user_id = p_user and m.undone_at is null and m.payment_id = p.id)
    union all
    select 'owner_contribution', o.id::text, null, 'Owner put money in', o.txn_date, o.amount_cents, abs(o.txn_date - t.date)
      from public.owner_transactions o
     where o.user_id = p_user and o.kind = 'contribution' and o.voided_at is null and o.account_id = acct and o.amount_cents = amt and abs(o.txn_date - t.date) <= 14
       and not exists (select 1 from public.bank_matches m where m.user_id = p_user and m.undone_at is null and m.owner_transaction_id = o.id)
    union all
    select 'loan_received', l.id::text, null, 'Loan received: ' || l.name, l.opened_date, l.principal_cents, abs(l.opened_date - t.date)
      from public.loans l
     where l.user_id = p_user and l.voided_at is null and l.proceeds_account_id = acct and l.principal_cents = amt and abs(l.opened_date - t.date) <= 14
       and not exists (select 1 from public.bank_matches m where m.user_id = p_user and m.undone_at is null and m.loan_id = l.id)
    union all
    select 'transfer', r.id::text, 'to', case r.kind when 'card_payment' then 'Card payment from ' else 'Transfer from ' end || (select name from public.accounts where id = r.from_account_id),
           r.transfer_date, r.amount_cents, abs(r.transfer_date - t.date)
      from public.transfers r
     where r.user_id = p_user and r.voided_at is null and r.to_account_id = acct and r.amount_cents = amt and abs(r.transfer_date - t.date) <= 14
       and not exists (select 1 from public.bank_matches m where m.user_id = p_user and m.undone_at is null and m.transfer_id = r.id and m.side = 'to')
    union all
    select 'refund', f.id::text, null, 'Refund', f.refund_date, f.amount_cents, abs(f.refund_date - t.date)
      from public.refunds f
     where f.user_id = p_user and f.voided_at is null and f.account_id = acct and f.amount_cents = amt and abs(f.refund_date - t.date) <= 14
       and not exists (select 1 from public.bank_matches m where m.user_id = p_user and m.undone_at is null and m.refund_id = f.id);
  end if;
end $$;

create or replace function public.bank_match_candidates(p_txn text)
returns table (kind text, target_id text, side text, label text, event_date date, amount_cents bigint, day_diff int)
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare u uuid := auth.uid(); t public.plaid_transactions;
begin
  if u is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select * into t from public.plaid_transactions where id = p_txn and user_id = u and status = 'active';
  if not found then raise exception 'transaction not found' using errcode = 'P0002'; end if;
  return query select c.kind, c.target_id, c.side, c.label, c.event_date, c.amount_cents, c.day_diff from public._bank_candidates(u, t) c order by c.day_diff, c.label;
end $$;

-- Matching outflow/inflow pairs between the user's own accounts (money leaves a BANK account, arrives in a bank or card account)
create or replace function public.bank_transfer_proposals()
returns table (out_txn text, in_txn text, out_account_id uuid, in_account_id uuid, amount_cents bigint, out_date date, in_date date, kind text, ambiguous boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
#variable_conflict use_column
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'not signed in' using errcode = '28000'; end if;
  return query
  with feed as (
    select t.id, t.amount, t.date, a.id as account_id, a.type as account_type
      from public.plaid_transactions t
      join public.bank_accounts b on b.user_id = t.user_id and b.plaid_account_id = t.plaid_account_id
      join public.accounts a on a.user_id = t.user_id and a.bank_account_id = b.id
     where t.user_id = u and t.status = 'active' and not t.pending and not t.excluded
       and not exists (select 1 from public.bank_matches m where m.user_id = u and m.plaid_transaction_id = t.id and m.undone_at is null)
  ), pairs as (
    select o.id oid, i.id iid, o.account_id oacc, i.account_id iacc, o.amount::bigint amt, o.date odate, i.date idate,
           case when i.account_type = 'liability' then 'card_payment' else 'transfer' end k
      from feed o join feed i on i.amount = -o.amount and i.account_id <> o.account_id and abs(i.date - o.date) <= 4
     where o.amount > 0 and o.account_type = 'asset'
  )
  select oid, iid, oacc, iacc, amt, odate, idate, k,
         (count(*) over (partition by oid) > 1 or count(*) over (partition by iid) > 1)
    from pairs order by odate desc, oid;
end $$;

-- ===== 6. resolving =====
create or replace function public._link_bank(p_user uuid, p_txn text, p_kind text, p_target text, p_side text, p_created boolean)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare mid uuid; prob text;
begin
  begin
    insert into public.bank_matches (user_id, plaid_transaction_id, kind, side, created_event, expense_id, payment_id, owner_transaction_id, transfer_id, loan_id, loan_payment_id, refund_id)
    values (p_user, p_txn, p_kind, p_side, p_created,
      case when p_kind = 'expense' then p_target end,
      case when p_kind = 'payment' then p_target::uuid end,
      case when p_kind in ('owner_draw', 'owner_contribution') then p_target::uuid end,
      case when p_kind = 'transfer' then p_target::uuid end,
      case when p_kind = 'loan_received' then p_target::uuid end,
      case when p_kind = 'loan_payment' then p_target::uuid end,
      case when p_kind = 'refund' then p_target::uuid end)
    returning id into mid;
  exception
    when foreign_key_violation then raise exception 'that recorded item was not found' using errcode = 'P0002';
    when unique_violation then raise exception 'that bank transaction or that recorded item is already linked' using errcode = '23505';
    when invalid_text_representation then raise exception 'that recorded item was not found' using errcode = 'P0002';
  end;
  prob := public._match_problem((select b from public.bank_matches b where b.id = mid));
  if prob is not null then raise exception 'These do not match: %.', prob using errcode = '23514'; end if;
  return mid;
end $$;

-- a posted, open transaction the user can resolve
create or replace function public._bank_txn_for_resolve(p_user uuid, p_txn text)
returns public.plaid_transactions language plpgsql security definer set search_path = public, pg_temp as $$
declare t public.plaid_transactions;
begin
  select * into t from public.plaid_transactions where id = p_txn and user_id = p_user and status = 'active' for update;
  if not found then raise exception 'transaction not found' using errcode = 'P0002'; end if;
  if t.pending then raise exception 'This transaction is still pending. You can record it once the bank posts it.' using errcode = '23514'; end if;
  if t.excluded then raise exception 'Put this transaction back in review before recording it.' using errcode = '23514'; end if;
  if exists (select 1 from public.bank_matches where plaid_transaction_id = t.id and user_id = p_user and undone_at is null) then
    raise exception 'This transaction is already recorded.' using errcode = '23505';
  end if;
  if public._bank_txn_account(p_user, t.plaid_account_id) is null then
    raise exception 'This transaction''s bank account is not set up in your books.' using errcode = '23514';
  end if;
  return t;
end $$;

-- Link a bank transaction to something already in the books.
create or replace function public.match_bank_transaction(p_txn text, p_kind text, p_target text, p_side text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := auth.uid(); t public.plaid_transactions;
begin
  if u is null then raise exception 'not signed in' using errcode = '28000'; end if;
  t := public._bank_txn_for_resolve(u, p_txn);
  if p_kind not in ('expense','payment','owner_draw','owner_contribution','transfer','loan_received','loan_payment','refund') then
    raise exception 'unknown kind' using errcode = '22023';
  end if;
  return public._link_bank(u, t.id, p_kind, p_target, case when p_kind = 'transfer' then p_side end, false);
end $$;

-- Confirm that an outflow and an inflow are the same transfer between the user's own accounts.
create or replace function public.confirm_transfer_pair(p_out text, p_in text, p_notes text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := auth.uid(); o public.plaid_transactions; i public.plaid_transactions; oa uuid; ia uuid; ty text; k text; tid uuid;
begin
  if u is null then raise exception 'not signed in' using errcode = '28000'; end if;
  perform public.seed_chart_of_accounts(u);
  if p_out = p_in then raise exception 'choose two different bank transactions' using errcode = '23514'; end if;
  -- lock in a fixed order so two confirmations cannot deadlock
  if p_out < p_in then o := public._bank_txn_for_resolve(u, p_out); i := public._bank_txn_for_resolve(u, p_in);
  else i := public._bank_txn_for_resolve(u, p_in); o := public._bank_txn_for_resolve(u, p_out); end if;
  if o.amount <= 0 or i.amount >= 0 or o.amount <> -i.amount then
    raise exception 'These two transactions are not the same amount going out of one account and into another.' using errcode = '23514';
  end if;
  oa := public._bank_txn_account(u, o.plaid_account_id); ia := public._bank_txn_account(u, i.plaid_account_id);
  if oa = ia then raise exception 'Both transactions are in the same account.' using errcode = '23514'; end if;
  select type into ty from public.accounts where id = ia;
  k := case when ty = 'liability' then 'card_payment' else 'transfer' end;
  tid := public._write_transfer(u, null, k, o.date, o.amount::bigint, oa, ia, p_notes);   -- also checks that the sending side is a bank account
  perform public._link_bank(u, o.id, 'transfer', tid::text, 'from', true);
  perform public._link_bank(u, i.id, 'transfer', tid::text, 'to', true);
  return tid;
end $$;

-- Record a bank transaction as a NEW event. Refused while a plausible existing event (or transfer partner) is unmatched,
-- unless the user says it is a separate one (confirm_new = true).
create or replace function public.resolve_bank_transaction(p_txn text, p_kind text, p_params jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  u uuid := auth.uid(); t public.plaid_transactions; acct uuid; amt bigint; confirm boolean := coalesce((p_params->>'confirm_new')::boolean, false);
  other uuid := nullif(p_params->>'other_account_id', '')::uuid; ty text; eid text; new_id uuid; notes text := nullif(btrim(coalesce(p_params->>'notes', '')), '');
  ints bigint;
begin
  if u is null then raise exception 'not signed in' using errcode = '28000'; end if;
  perform public.seed_chart_of_accounts(u);
  if p_kind = 'unsure' then
    select * into t from public.plaid_transactions where id = p_txn and user_id = u and status = 'active' for update;
    if not found then raise exception 'transaction not found' using errcode = 'P0002'; end if;
    if t.excluded or exists (select 1 from public.bank_matches where plaid_transaction_id = t.id and user_id = u and undone_at is null) then
      raise exception 'This transaction is already handled.' using errcode = '23514';
    end if;
    update public.plaid_transactions set review_state = 'unsure', review_note = notes, updated_at = now() where id = t.id;
    return null;
  end if;

  t := public._bank_txn_for_resolve(u, p_txn);
  acct := public._bank_txn_account(u, t.plaid_account_id); amt := abs(t.amount)::bigint;
  if p_kind not in ('expense','owner_draw','owner_contribution','loan_payment','loan_received','transfer_to','transfer_from','customer_payment','refund') then
    raise exception 'unknown way to record this transaction' using errcode = '22023';
  end if;
  if p_kind in ('expense','owner_draw','loan_payment','transfer_to') and t.amount <= 0 then
    raise exception 'This is money coming in; it cannot be recorded as money going out.' using errcode = '23514';
  end if;
  if p_kind in ('owner_contribution','loan_received','transfer_from','customer_payment','refund') and t.amount >= 0 then
    raise exception 'This is money going out; it cannot be recorded as money coming in.' using errcode = '23514';
  end if;

  if not confirm then
    if exists (select 1 from public._bank_candidates(u, t)) then
      raise exception 'You already recorded something that looks like this. Match it instead, or confirm this is a separate one.' using errcode = 'BC001';
    end if;
    if exists (select 1 from public.bank_transfer_proposals() p where p.out_txn = t.id or p.in_txn = t.id) then
      raise exception 'This looks like a transfer between your own accounts. Confirm the pair instead, or confirm this is a separate one.' using errcode = 'BC001';
    end if;
  end if;

  case p_kind
    when 'expense' then
      eid := gen_random_uuid()::text;
      perform public.save_expense(jsonb_build_object('id', eid, 'date', t.date, 'vendor', coalesce(t.merchant_name, t.name),
        'category', p_params->>'category', 'amount', t.amount, 'notes', coalesce(notes, 'Imported from bank transaction.')), acct);
      return public._link_bank(u, t.id, 'expense', eid, null, true);
    when 'owner_draw' then
      new_id := public._write_owner_txn(u, null, 'draw', t.date, amt, acct, notes);
      return public._link_bank(u, t.id, 'owner_draw', new_id::text, null, true);
    when 'owner_contribution' then
      new_id := public._write_owner_txn(u, null, 'contribution', t.date, amt, acct, notes);
      return public._link_bank(u, t.id, 'owner_contribution', new_id::text, null, true);
    when 'loan_payment' then
      ints := coalesce((p_params->>'interest_cents')::bigint, 0);
      if ints < 0 or ints >= amt then raise exception 'Interest must be less than the payment amount.' using errcode = '23514'; end if;
      new_id := public.record_loan_payment((p_params->>'loan_id')::uuid, t.date, amt - ints, ints, acct, notes);
      return public._link_bank(u, t.id, 'loan_payment', new_id::text, null, true);
    when 'loan_received' then
      new_id := public.record_loan(coalesce(nullif(btrim(p_params->>'name'), ''), 'Loan'), nullif(btrim(coalesce(p_params->>'lender', '')), ''), amt, t.date, acct,
                               nullif(p_params->>'interest_rate_bps', '')::int, notes);
      return public._link_bank(u, t.id, 'loan_received', new_id::text, null, true);
    when 'transfer_to' then
      if other is null then raise exception 'Choose the account the money went to.' using errcode = '23514'; end if;
      select type into ty from public.accounts where id = other and user_id = u;
      new_id := public._write_transfer(u, null, case when ty = 'liability' then 'card_payment' else 'transfer' end, t.date, amt, acct, other, notes);
      return public._link_bank(u, t.id, 'transfer', new_id::text, 'from', true);
    when 'transfer_from' then
      if other is null then raise exception 'Choose the account the money came from.' using errcode = '23514'; end if;
      select type into ty from public.accounts where id = acct;
      new_id := public._write_transfer(u, null, case when ty = 'liability' then 'card_payment' else 'transfer' end, t.date, amt, other, acct, notes);
      return public._link_bank(u, t.id, 'transfer', new_id::text, 'to', true);
    when 'customer_payment' then
      if nullif(p_params->>'customer_id', '') is null then raise exception 'Choose the customer who paid.' using errcode = '23514'; end if;
      new_id := public.record_payment(p_params->>'customer_id', t.date, amt, acct, coalesce(p_params->'applications', '[]'::jsonb),
                                  coalesce(nullif(p_params->>'method', ''), 'other'), nullif(p_params->>'reference', ''), notes);
      return public._link_bank(u, t.id, 'payment', new_id::text, null, true);
    when 'refund' then
      new_id := public._write_refund(u, null, t.date, amt, acct, p_params->>'category', notes);
      return public._link_bank(u, t.id, 'refund', new_id::text, null, true);
  end case;
  return null;
end $$;

-- Undo: unlink; if this bank transaction created the event, void (or delete) that event as well. Both sides of a transfer go together.
create or replace function public.undo_bank_resolution(p_txn text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := auth.uid(); m public.bank_matches;
begin
  if u is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select * into m from public.bank_matches where plaid_transaction_id = p_txn and user_id = u and undone_at is null for update;
  if not found then raise exception 'This transaction is not recorded.' using errcode = 'P0002'; end if;
  update public.bank_matches set undone_at = now(), undone_reason = 'You undid it.'
   where user_id = u and undone_at is null and (id = m.id or (m.transfer_id is not null and transfer_id = m.transfer_id));
  if m.created_event then
    case m.kind
      when 'expense' then perform public.delete_expense(m.expense_id);
      when 'payment' then perform public.void_payment(m.payment_id);
      when 'owner_draw' then perform public.void_owner_transaction(m.owner_transaction_id);
      when 'owner_contribution' then perform public.void_owner_transaction(m.owner_transaction_id);
      when 'transfer' then perform public.void_transfer(m.transfer_id);
      when 'loan_received' then perform public.void_loan(m.loan_id);
      when 'loan_payment' then perform public.void_loan_payment(m.loan_payment_id);
      when 'refund' then perform public.void_refund(m.refund_id);
    end case;
  end if;
end $$;

-- deleting an expense releases (and removes) its bank link; the bank transaction returns to review
create or replace function public.delete_expense(p_expense_id text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := auth.uid(); act uuid;
begin
  if u is null then raise exception 'not signed in' using errcode = '28000'; end if;
  perform pg_advisory_xact_lock(hashtextextended(u::text || '|expense|' || p_expense_id, 1));
  if not exists (select 1 from public.expenses where id = p_expense_id and user_id = u) then
    raise exception 'expense not found' using errcode = 'P0002';
  end if;
  act := public._active_entry(u, 'expense', p_expense_id);
  if act is not null then perform public._reverse_entry(u, act, 'Expense deleted'); end if;
  delete from public.bank_matches where user_id = u and expense_id = p_expense_id;
  delete from public.expenses where id = p_expense_id and user_id = u;     -- receipts cascade
end $$;

drop function if exists public.categorize_plaid_transaction(text, text);

-- ===== privileges =====
do $$
declare f text;
begin
  foreach f in array array[
    '_check_refund(uuid)', '_sync_refund_posting(uuid,uuid)', '_tg_refund_check()', 'refunds_block_delete_when_posted()',
    '_write_refund(uuid,uuid,date,bigint,uuid,text,text)', '_bank_txn_account(uuid,text)', '_match_problem(public.bank_matches)',
    '_tg_bank_match_check()', '_tg_revalidate_matches()', '_release_match(uuid,text,text)', '_supersede_pending(uuid,text,text)',
    '_remove_plaid_txn(uuid,text)', '_bank_candidates(uuid,public.plaid_transactions)', '_link_bank(uuid,text,text,text,text,boolean)',
    '_bank_txn_for_resolve(uuid,text)']
  loop execute format('revoke all on function public.%s from public, anon, authenticated', f); end loop;
  foreach f in array array[
    'record_refund(date,bigint,uuid,text,text)', 'update_refund(uuid,date,bigint,uuid,text,text)', 'void_refund(uuid)',
    'bank_match_candidates(text)', 'bank_transfer_proposals()', 'match_bank_transaction(text,text,text,text)',
    'confirm_transfer_pair(text,text,text)', 'resolve_bank_transaction(text,text,jsonb)', 'undo_bank_resolution(text)',
    'exclude_bank_transaction(text)', 'restore_bank_transaction(text)', 'delete_expense(text)']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
