-- Stage D1 (applied as Supabase migration "stage_d1_event_helpers_and_transfers").
-- Shared event helpers + transfers between own accounts (and, in D4, credit-card payments).

-- ===== Account requirements =====
create or replace function public._require_account(p_user uuid, p_account uuid, p_kind text, p_msg text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.accounts;
begin
  select * into a from public.accounts where id = p_account and user_id = p_user;
  if not found or not a.is_active or a.system_key is not null or a.bank_account_id is null
     or a.type is distinct from (case p_kind when 'bank' then 'asset' when 'card' then 'liability' end) then
    raise exception '%', p_msg using errcode = '23514';
  end if;
end $$;

-- ===== Generic event posting: a source row owns exactly one active entry with known debit/credit account maps =====
-- p_debits / p_credits are {"<account uuid>": cents}; zero/null amounts are dropped.
create or replace function public._entry_matches(p_entry uuid, p_date date, p_debits jsonb, p_credits jsonb)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select e.entry_date = p_date
    and coalesce((select jsonb_object_agg(account_id::text, s) from (select account_id, sum(debit_cents) s from public.journal_lines where entry_id = e.id and debit_cents > 0 group by 1) d), '{}'::jsonb) = jsonb_strip_nulls(p_debits)
    and coalesce((select jsonb_object_agg(account_id::text, s) from (select account_id, sum(credit_cents) s from public.journal_lines where entry_id = e.id and credit_cents > 0 group by 1) c), '{}'::jsonb) = jsonb_strip_nulls(p_credits)
  from public.journal_entries e where e.id = p_entry $$;

create or replace function public._post_event(p_user uuid, p_type text, p_id text, p_date date, p_memo text, p_debits jsonb, p_credits jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare d jsonb; c jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object('account_id', k, 'debit', v::bigint)), '[]'::jsonb) into d from jsonb_each_text(jsonb_strip_nulls(p_debits)) x(k, v);
  select coalesce(jsonb_agg(jsonb_build_object('account_id', k, 'credit', v::bigint)), '[]'::jsonb) into c from jsonb_each_text(jsonb_strip_nulls(p_credits)) x(k, v);
  return public._post_entry(p_user, p_date, p_memo, p_type, p_id, d || c);
end $$;

create or replace function public._sync_event(p_user uuid, p_type text, p_id text, p_live boolean, p_date date, p_memo text, p_debits jsonb, p_credits jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare act uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text || '|' || p_type || '|' || p_id, 1));
  act := public._active_entry(p_user, p_type, p_id);
  if not p_live then
    if act is not null then perform public._reverse_entry(p_user, act, 'Voided'); end if;
    return null;
  end if;
  if act is not null then
    if public._entry_matches(act, p_date, p_debits, p_credits) then return act; end if;
    perform public._reverse_entry(p_user, act, 'Edited');
  end if;
  return public._post_event(p_user, p_type, p_id, p_date, p_memo, p_debits, p_credits);
end $$;

-- Commit-time check used by every event table: a live row has exactly the expected active entry; a voided row has none.
create or replace function public._check_event(p_user uuid, p_type text, p_id text, p_live boolean, p_date date, p_debits jsonb, p_credits jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare act uuid;
begin
  act := public._active_entry(p_user, p_type, p_id);
  if not p_live then
    if act is not null then raise exception 'a voided % must not have an active ledger entry', p_type using errcode = '23514'; end if;
    return;
  end if;
  if act is null then raise exception '% % is not posted to the books', p_type, p_id using errcode = '23514'; end if;
  if not public._entry_matches(act, p_date, p_debits, p_credits) then
    raise exception '% % does not match its ledger entry', p_type, p_id using errcode = '23514';
  end if;
end $$;

-- ===== Transfers =====
create table public.transfers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('transfer', 'card_payment')),
  transfer_date date not null check (transfer_date between '2000-01-01' and '2100-12-31'),
  amount_cents bigint not null check (amount_cents > 0),
  from_account_id uuid not null,
  to_account_id uuid not null,
  notes text,
  voided_at timestamptz,
  created_at timestamptz not null default now(),
  constraint transfers_id_user_unique unique (id, user_id),
  constraint transfers_from_owner_fkey foreign key (from_account_id, user_id) references public.accounts (id, user_id),
  constraint transfers_to_owner_fkey foreign key (to_account_id, user_id) references public.accounts (id, user_id),
  constraint transfers_different_accounts check (from_account_id <> to_account_id)
);
alter table public.transfers enable row level security;
create policy transfers_select_own on public.transfers for select to authenticated using (auth.uid() = user_id);
revoke all on public.transfers from public, anon, authenticated;
grant select on public.transfers to authenticated;

create or replace function public._check_transfer(p_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare t public.transfers;
begin
  select * into t from public.transfers where id = p_id;
  if not found then return; end if;
  perform public._check_event(t.user_id, 'transfer', t.id::text, t.voided_at is null, t.transfer_date,
    jsonb_build_object(t.to_account_id::text, t.amount_cents), jsonb_build_object(t.from_account_id::text, t.amount_cents));
end $$;

create or replace function public._sync_transfer_posting(p_user uuid, p_id uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare t public.transfers; f text; g text;
begin
  select * into t from public.transfers where id = p_id and user_id = p_user;
  if not found then raise exception 'transfer not found' using errcode = 'P0002'; end if;
  select name into f from public.accounts where id = t.from_account_id;
  select name into g from public.accounts where id = t.to_account_id;
  return public._sync_event(p_user, 'transfer', t.id::text, t.voided_at is null, t.transfer_date,
    case t.kind when 'card_payment' then 'Card payment: ' else 'Transfer: ' end || f || ' to ' || g,
    jsonb_build_object(t.to_account_id::text, t.amount_cents), jsonb_build_object(t.from_account_id::text, t.amount_cents));
end $$;

create or replace function public._tg_transfer_check() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin perform public._check_transfer(new.id); return null; end $$;
create constraint trigger transfers_check after insert or update on public.transfers
  deferrable initially deferred for each row execute function public._tg_transfer_check();

create or replace function public.transfers_block_delete_when_posted() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from auth.users u where u.id = old.user_id) and public._active_entry(old.user_id, 'transfer', old.id::text) is not null then
    raise exception 'transfer is posted to the books; void it instead of deleting' using errcode = '23503';
  end if;
  return old;
end $$;
create trigger transfers_block_delete_when_posted before delete on public.transfers
  for each row execute function public.transfers_block_delete_when_posted();

-- Any ledger entry for an event source must keep that source consistent (also closes direct reverse_journal_entry on event entries).
create or replace function public._tg_entry_source_check() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.source_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return null; end if;
  case new.source_type
    when 'payment'  then perform public._check_payment(new.source_id::uuid);
    when 'transfer' then perform public._check_transfer(new.source_id::uuid);
    else null;
  end case;
  return null;
end $$;
create constraint trigger journal_entries_source_check after insert on public.journal_entries
  deferrable initially deferred for each row
  when (new.source_type in ('payment','transfer','owner_draw','owner_contribution','loan','loan_payment','equipment'))
  execute function public._tg_entry_source_check();

-- ===== Public API: bank-to-bank transfers =====
create or replace function public._write_transfer(p_user uuid, p_id uuid, p_kind text, p_date date, p_amount bigint, p_from uuid, p_to uuid, p_notes text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare tid uuid := p_id;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'amount must be greater than zero' using errcode = '23514'; end if;
  if p_date is null then raise exception 'a date is required' using errcode = '23514'; end if;
  if p_from = p_to then raise exception 'choose two different accounts' using errcode = '23514'; end if;
  perform public._require_account(p_user, p_from, 'bank', 'choose the bank account the money came from');
  if p_kind = 'transfer' then
    perform public._require_account(p_user, p_to, 'bank', 'choose the bank account the money went to');
  else
    perform public._require_account(p_user, p_to, 'card', 'choose the credit card that was paid');
  end if;
  if tid is null then
    insert into public.transfers (user_id, kind, transfer_date, amount_cents, from_account_id, to_account_id, notes)
    values (p_user, p_kind, p_date, p_amount, p_from, p_to, p_notes) returning id into tid;
  else
    update public.transfers set transfer_date = p_date, amount_cents = p_amount, from_account_id = p_from, to_account_id = p_to, notes = p_notes where id = tid;
  end if;
  perform public._sync_transfer_posting(p_user, tid);
  return tid;
end $$;

create or replace function public.record_transfer(p_date date, p_amount_cents bigint, p_from_account_id uuid, p_to_account_id uuid, p_notes text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'not signed in' using errcode = '28000'; end if;
  perform public.seed_chart_of_accounts(u);
  return public._write_transfer(u, null, 'transfer', p_date, p_amount_cents, p_from_account_id, p_to_account_id, p_notes);
end $$;

create or replace function public.update_transfer(p_id uuid, p_date date, p_amount_cents bigint, p_from_account_id uuid, p_to_account_id uuid, p_notes text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := auth.uid(); t public.transfers;
begin
  if u is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select * into t from public.transfers where id = p_id and user_id = u for update;
  if not found then raise exception 'transfer not found' using errcode = 'P0002'; end if;
  if t.voided_at is not null then raise exception 'a voided transfer cannot be edited' using errcode = '23514'; end if;
  return public._write_transfer(u, t.id, t.kind, p_date, p_amount_cents, p_from_account_id, p_to_account_id, p_notes);
end $$;

create or replace function public.void_transfer(p_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := auth.uid(); t public.transfers;
begin
  if u is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select * into t from public.transfers where id = p_id and user_id = u for update;
  if not found then raise exception 'transfer not found' using errcode = 'P0002'; end if;
  if t.voided_at is not null then return; end if;
  update public.transfers set voided_at = now() where id = t.id;
  perform public._sync_transfer_posting(u, t.id);
end $$;

-- ===== Privileges =====
do $$
declare f text;
begin
  foreach f in array array[
    '_require_account(uuid,uuid,text,text)', '_entry_matches(uuid,date,jsonb,jsonb)',
    '_post_event(uuid,text,text,date,text,jsonb,jsonb)', '_sync_event(uuid,text,text,boolean,date,text,jsonb,jsonb)',
    '_check_event(uuid,text,text,boolean,date,jsonb,jsonb)', '_check_transfer(uuid)', '_sync_transfer_posting(uuid,uuid)',
    '_tg_transfer_check()', 'transfers_block_delete_when_posted()', '_tg_entry_source_check()',
    '_write_transfer(uuid,uuid,text,date,bigint,uuid,uuid,text)']
  loop execute format('revoke all on function public.%s from public, anon, authenticated', f); end loop;
  foreach f in array array['record_transfer(date,bigint,uuid,uuid,text)', 'update_transfer(uuid,date,bigint,uuid,uuid,text)', 'void_transfer(uuid)']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
