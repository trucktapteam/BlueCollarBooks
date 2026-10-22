-- Stage D2 (applied as Supabase migration "stage_d2_owner_events").
-- Owner draws / contributions, and expenses the owner paid personally.

create table public.owner_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('draw', 'contribution')),
  txn_date date not null check (txn_date between '2000-01-01' and '2100-12-31'),
  amount_cents bigint not null check (amount_cents > 0),
  account_id uuid not null,
  notes text,
  voided_at timestamptz,
  created_at timestamptz not null default now(),
  constraint owner_transactions_id_user_unique unique (id, user_id),
  constraint owner_transactions_account_owner_fkey foreign key (account_id, user_id) references public.accounts (id, user_id)
);
alter table public.owner_transactions enable row level security;
create policy owner_transactions_select_own on public.owner_transactions for select to authenticated using (auth.uid() = user_id);
revoke all on public.owner_transactions from public, anon, authenticated;
grant select on public.owner_transactions to authenticated;

-- draw: Dr Owner Draws / Cr bank.  contribution: Dr bank / Cr Owner Contributions.  Never income, never expense.
create or replace function public._owner_legs(t public.owner_transactions)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare eq uuid;
begin
  select id into eq from public.accounts where user_id = t.user_id and system_key = case t.kind when 'draw' then 'owner_draws' else 'owner_contributions' end;
  if t.kind = 'draw' then
    return jsonb_build_object('d', jsonb_build_object(eq::text, t.amount_cents), 'c', jsonb_build_object(t.account_id::text, t.amount_cents));
  end if;
  return jsonb_build_object('d', jsonb_build_object(t.account_id::text, t.amount_cents), 'c', jsonb_build_object(eq::text, t.amount_cents));
end $$;

create or replace function public._owner_source(p_kind text) returns text language sql immutable as $$
  select case p_kind when 'draw' then 'owner_draw' else 'owner_contribution' end $$;

create or replace function public._check_owner_txn(p_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare t public.owner_transactions; l jsonb;
begin
  select * into t from public.owner_transactions where id = p_id;
  if not found then return; end if;
  l := public._owner_legs(t);
  perform public._check_event(t.user_id, public._owner_source(t.kind), t.id::text, t.voided_at is null, t.txn_date, l->'d', l->'c');
end $$;

create or replace function public._sync_owner_posting(p_user uuid, p_id uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare t public.owner_transactions; l jsonb; an text;
begin
  select * into t from public.owner_transactions where id = p_id and user_id = p_user;
  if not found then raise exception 'owner transaction not found' using errcode = 'P0002'; end if;
  l := public._owner_legs(t);
  select name into an from public.accounts where id = t.account_id;
  return public._sync_event(p_user, public._owner_source(t.kind), t.id::text, t.voided_at is null, t.txn_date,
    case t.kind when 'draw' then 'Owner draw from ' else 'Owner contribution to ' end || an, l->'d', l->'c');
end $$;

create or replace function public._tg_owner_check() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin perform public._check_owner_txn(new.id); return null; end $$;
create constraint trigger owner_transactions_check after insert or update on public.owner_transactions
  deferrable initially deferred for each row execute function public._tg_owner_check();

create or replace function public.owner_transactions_block_delete_when_posted() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from auth.users u where u.id = old.user_id) and public._active_entry(old.user_id, public._owner_source(old.kind), old.id::text) is not null then
    raise exception 'owner transaction is posted to the books; void it instead of deleting' using errcode = '23503';
  end if;
  return old;
end $$;
create trigger owner_transactions_block_delete_when_posted before delete on public.owner_transactions
  for each row execute function public.owner_transactions_block_delete_when_posted();

create or replace function public._tg_entry_source_check() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.source_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return null; end if;
  case new.source_type
    when 'payment'            then perform public._check_payment(new.source_id::uuid);
    when 'transfer'           then perform public._check_transfer(new.source_id::uuid);
    when 'owner_draw'         then perform public._check_owner_txn(new.source_id::uuid);
    when 'owner_contribution' then perform public._check_owner_txn(new.source_id::uuid);
    else null;
  end case;
  return null;
end $$;

create or replace function public._write_owner_txn(p_user uuid, p_id uuid, p_kind text, p_date date, p_amount bigint, p_account uuid, p_notes text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare tid uuid := p_id;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'amount must be greater than zero' using errcode = '23514'; end if;
  if p_date is null then raise exception 'a date is required' using errcode = '23514'; end if;
  perform public._require_account(p_user, p_account, 'bank',
    case p_kind when 'draw' then 'choose the bank account the money was taken from' else 'choose the bank account the money was put into' end);
  if tid is null then
    insert into public.owner_transactions (user_id, kind, txn_date, amount_cents, account_id, notes)
    values (p_user, p_kind, p_date, p_amount, p_account, p_notes) returning id into tid;
  else
    update public.owner_transactions set txn_date = p_date, amount_cents = p_amount, account_id = p_account, notes = p_notes where id = tid;
  end if;
  perform public._sync_owner_posting(p_user, tid);
  return tid;
end $$;

create or replace function public.record_owner_draw(p_date date, p_amount_cents bigint, p_account_id uuid, p_notes text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'not signed in' using errcode = '28000'; end if;
  perform public.seed_chart_of_accounts(u);
  return public._write_owner_txn(u, null, 'draw', p_date, p_amount_cents, p_account_id, p_notes);
end $$;

create or replace function public.record_owner_contribution(p_date date, p_amount_cents bigint, p_account_id uuid, p_notes text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'not signed in' using errcode = '28000'; end if;
  perform public.seed_chart_of_accounts(u);
  return public._write_owner_txn(u, null, 'contribution', p_date, p_amount_cents, p_account_id, p_notes);
end $$;

create or replace function public.update_owner_transaction(p_id uuid, p_date date, p_amount_cents bigint, p_account_id uuid, p_notes text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := auth.uid(); t public.owner_transactions;
begin
  if u is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select * into t from public.owner_transactions where id = p_id and user_id = u for update;
  if not found then raise exception 'owner transaction not found' using errcode = 'P0002'; end if;
  if t.voided_at is not null then raise exception 'a voided owner transaction cannot be edited' using errcode = '23514'; end if;
  return public._write_owner_txn(u, t.id, t.kind, p_date, p_amount_cents, p_account_id, p_notes);
end $$;

create or replace function public.void_owner_transaction(p_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := auth.uid(); t public.owner_transactions;
begin
  if u is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select * into t from public.owner_transactions where id = p_id and user_id = u for update;
  if not found then raise exception 'owner transaction not found' using errcode = 'P0002'; end if;
  if t.voided_at is not null then return; end if;
  update public.owner_transactions set voided_at = now() where id = t.id;
  perform public._sync_owner_posting(u, t.id);
end $$;

-- Expenses: the "Paid from" account must be a real bank/credit-card account, OR the owner's own money
-- (Owner Contributions: "paid personally by the owner" = Dr expense / Cr Owner Contributions).
-- Tightened from "any asset/liability account", which wrongly allowed Accounts Receivable, Equipment, Loans Payable.
create or replace function public._post_expense(p_user uuid, p_expense_id text, p_paid_from uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare x public.expenses; pf public.accounts; ea uuid; memo text; ok boolean;
begin
  select * into x from public.expenses where id = p_expense_id and user_id = p_user;
  if not found then raise exception 'expense not found' using errcode = 'P0002'; end if;
  if x.amount is null or x.amount <= 0 then raise exception 'expense amount must be greater than zero to post' using errcode = '23514'; end if;
  if x.date is null then raise exception 'expense needs a date to post' using errcode = '23514'; end if;

  -- (Applied first as "stage_d2_owner_events", then corrected by "stage_d2_fix_expense_paid_from_null_logic":
  --  the first version let an expense account through because `not (false or NULL)` is NULL, not true. Tests caught it.)
  select * into pf from public.accounts where id = p_paid_from and user_id = p_user;
  ok := found and pf.is_active and (
          (pf.type in ('asset','liability') and pf.system_key is null and pf.bank_account_id is not null)
          or coalesce(pf.system_key, '') = 'owner_contributions');
  if not coalesce(ok, false) then
    raise exception 'choose the bank or credit-card account the expense was paid from, or mark it as paid personally by the owner' using errcode = '23514';
  end if;

  select id into ea from public.accounts
   where user_id = p_user and type = 'expense' and lower(name) = lower(btrim(coalesce(x.category, ''))) limit 1;
  if ea is null then
    select id into ea from public.accounts where user_id = p_user and system_key = 'uncategorized_expense';
  end if;

  memo := x.vendor || case when coalesce(btrim(x.notes), '') <> '' then ' - ' || btrim(x.notes) else '' end
          || case when pf.system_key = 'owner_contributions' then ' (paid personally by owner)' else '' end;
  return public._post_entry(p_user, x.date, memo, 'expense', x.id, jsonb_build_array(
    jsonb_build_object('account_id', ea, 'debit', x.amount),
    jsonb_build_object('account_id', p_paid_from, 'credit', x.amount)));
end $$;

-- Privileges
do $$
declare f text;
begin
  foreach f in array array['_owner_legs(public.owner_transactions)', '_owner_source(text)', '_check_owner_txn(uuid)', '_sync_owner_posting(uuid,uuid)',
    '_tg_owner_check()', 'owner_transactions_block_delete_when_posted()', '_write_owner_txn(uuid,uuid,text,date,bigint,uuid,text)']
  loop execute format('revoke all on function public.%s from public, anon, authenticated', f); end loop;
  foreach f in array array['record_owner_draw(date,bigint,uuid,text)', 'record_owner_contribution(date,bigint,uuid,text)',
    'update_owner_transaction(uuid,date,bigint,uuid,text)', 'void_owner_transaction(uuid)']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
