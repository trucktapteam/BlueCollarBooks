-- Stage B2: journal entries + lines, enforced invariants (applied as Supabase migration "stage_b2_journal").
create table public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  entry_date date not null check (entry_date between date '2000-01-01' and date '2100-12-31'),
  memo text,
  source_type text not null check (source_type in
    ('invoice','payment','expense','bank_transaction','transfer','loan','loan_payment',
     'owner_draw','owner_contribution','equipment','opening_balance','manual')),
  source_id text,
  reverses_entry_id uuid,
  txid xid8 not null default pg_current_xact_id(),   -- transaction that created it; lines may only be added in that same transaction
  created_at timestamptz not null default now(),
  constraint journal_entries_id_user_unique unique (id, user_id),
  constraint journal_entries_reverses_fkey foreign key (reverses_entry_id, user_id)
    references public.journal_entries (id, user_id),
  constraint journal_entries_source_required check (source_type = 'manual' or source_id is not null),
  constraint journal_entries_not_self_reversal check (reverses_entry_id is distinct from id)
);
create unique index journal_entries_one_reversal on public.journal_entries (reverses_entry_id) where reverses_entry_id is not null;
create index journal_entries_source_idx on public.journal_entries (user_id, source_type, source_id);
create index journal_entries_date_idx on public.journal_entries (user_id, entry_date);

create table public.journal_lines (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null,
  debit_cents bigint not null default 0,
  credit_cents bigint not null default 0,
  memo text,
  created_at timestamptz not null default now(),
  constraint journal_lines_one_side check ((debit_cents > 0 and credit_cents = 0) or (debit_cents = 0 and credit_cents > 0)),
  constraint journal_lines_entry_owner_fkey foreign key (entry_id, user_id) references public.journal_entries (id, user_id),
  constraint journal_lines_account_owner_fkey foreign key (account_id, user_id) references public.accounts (id, user_id)
);
create index journal_lines_entry_idx on public.journal_lines (entry_id);
create index journal_lines_account_idx on public.journal_lines (account_id);

-- Access: read own rows only. No insert/update/delete privilege for any app role;
-- rows are written only by SECURITY DEFINER posting functions.
alter table public.journal_entries enable row level security;
alter table public.journal_lines   enable row level security;
create policy journal_entries_select_own on public.journal_entries for select to authenticated using (auth.uid() = user_id);
create policy journal_lines_select_own   on public.journal_lines   for select to authenticated using (auth.uid() = user_id);
revoke all on public.journal_entries, public.journal_lines from public, anon, authenticated;
grant select on public.journal_entries, public.journal_lines to authenticated;

-- Invariant 3: posted rows are immutable (applies to every role, including service role).
create or replace function public.ledger_immutable() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'DELETE' and not exists (select 1 from auth.users u where u.id = old.user_id) then
    return old;  -- whole user is being deleted; cascade is allowed
  end if;
  raise exception 'ledger rows are immutable (% on %): post a reversing entry instead', tg_op, tg_table_name using errcode = '23514';
end $$;
create trigger journal_entries_immutable before update or delete on public.journal_entries for each row execute function public.ledger_immutable();
create trigger journal_lines_immutable   before update or delete on public.journal_lines   for each row execute function public.ledger_immutable();

create or replace function public.ledger_no_truncate() returns trigger language plpgsql as $$
begin raise exception 'ledger tables cannot be truncated' using errcode = '23514'; end $$;
create trigger journal_entries_no_truncate before truncate on public.journal_entries for each statement execute function public.ledger_no_truncate();
create trigger journal_lines_no_truncate   before truncate on public.journal_lines   for each statement execute function public.ledger_no_truncate();

-- Lines may only be added while the entry's own creating transaction is still open.
create or replace function public.journal_lines_only_in_creating_txn() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from public.journal_entries e where e.id = new.entry_id and e.txid = pg_current_xact_id()) then
    raise exception 'lines cannot be added to an already-posted journal entry' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger journal_lines_txn_guard before insert on public.journal_lines for each row execute function public.journal_lines_only_in_creating_txn();

-- Invariants 1, 5 and no-double-posting, checked at COMMIT (deferred). Invariant 4 is the composite FKs above.
create or replace function public.validate_journal_entry(p_entry uuid) returns void language plpgsql set search_path = public, pg_temp as $$
declare
  e public.journal_entries; o public.journal_entries;
  d bigint; c bigint; n int; mism int;
begin
  select * into e from public.journal_entries where id = p_entry;
  if not found then return; end if;

  select coalesce(sum(debit_cents),0), coalesce(sum(credit_cents),0), count(*) into d, c, n
  from public.journal_lines where entry_id = p_entry;
  if n < 2 then
    raise exception 'journal entry % needs at least two lines', p_entry using errcode = '23514';
  end if;
  if d <> c then
    raise exception 'journal entry % is unbalanced: debits % <> credits %', p_entry, d, c using errcode = '23514';
  end if;

  if e.reverses_entry_id is null and e.source_type <> 'manual' then
    perform pg_advisory_xact_lock(hashtextextended(e.user_id::text || '|' || e.source_type || '|' || e.source_id, 1));
    select count(*) into n from public.journal_entries x
     where x.user_id = e.user_id and x.source_type = e.source_type and x.source_id = e.source_id
       and x.reverses_entry_id is null
       and not exists (select 1 from public.journal_entries r where r.reverses_entry_id = x.id);
    if n > 1 then
      raise exception 'source % % already has an active ledger entry; reverse it first', e.source_type, e.source_id using errcode = '23505';
    end if;
  end if;

  if e.reverses_entry_id is not null then
    select * into o from public.journal_entries where id = e.reverses_entry_id;
    if o.reverses_entry_id is not null then
      raise exception 'a reversal cannot itself be reversed' using errcode = '23514';
    end if;
    if o.source_type <> e.source_type or o.source_id is distinct from e.source_id or o.entry_date <> e.entry_date then
      raise exception 'a reversal must keep the original source and date' using errcode = '23514';
    end if;
    select count(*) into mism from (
      (select account_id, credit_cents as debit_cents, debit_cents as credit_cents from public.journal_lines where entry_id = o.id
       except all
       select account_id, debit_cents, credit_cents from public.journal_lines where entry_id = e.id)
      union all
      (select account_id, debit_cents, credit_cents from public.journal_lines where entry_id = e.id
       except all
       select account_id, credit_cents, debit_cents from public.journal_lines where entry_id = o.id)
    ) t;
    if mism > 0 then
      raise exception 'reversal does not exactly negate entry %', o.id using errcode = '23514';
    end if;
  end if;
end $$;

create or replace function public.journal_validate_from_line()  returns trigger language plpgsql as $$ begin perform public.validate_journal_entry(new.entry_id); return null; end $$;
create or replace function public.journal_validate_from_entry() returns trigger language plpgsql as $$ begin perform public.validate_journal_entry(new.id); return null; end $$;
create constraint trigger journal_lines_validate   after insert on public.journal_lines   deferrable initially deferred for each row execute function public.journal_validate_from_line();
create constraint trigger journal_entries_validate after insert on public.journal_entries deferrable initially deferred for each row execute function public.journal_validate_from_entry();

-- Read-only views (run with the caller's permissions, so RLS applies).
create view public.account_balances with (security_invoker = true) as
select a.id as account_id, a.user_id, a.name, a.type, a.system_key,
       coalesce(sum(l.debit_cents),0)::bigint  as debit_total,
       coalesce(sum(l.credit_cents),0)::bigint as credit_total,
       (case when a.type in ('asset','expense')
             then coalesce(sum(l.debit_cents - l.credit_cents),0)
             else coalesce(sum(l.credit_cents - l.debit_cents),0) end)::bigint as balance_cents
from public.accounts a left join public.journal_lines l on l.account_id = a.id
group by a.id;

create view public.journal_entry_trace with (security_invoker = true) as
select e.id, e.user_id, e.entry_date, e.memo, e.source_type, e.source_id, e.reverses_entry_id, e.created_at,
       case when e.reverses_entry_id is not null then 'reversal'
            when exists (select 1 from public.journal_entries r where r.reverses_entry_id = e.id) then 'reversed'
            else 'active' end as status
from public.journal_entries e;

revoke all on public.account_balances, public.journal_entry_trace from public, anon, authenticated;
grant select on public.account_balances, public.journal_entry_trace to authenticated;

-- Follow-up migration "stage_b2_revoke_internal_function_execute": internal functions are not callable by app roles.
revoke all on function public.validate_journal_entry(uuid) from public, anon, authenticated;
revoke all on function public.journal_validate_from_line() from public, anon, authenticated;
revoke all on function public.journal_validate_from_entry() from public, anon, authenticated;
revoke all on function public.ledger_immutable() from public, anon, authenticated;
revoke all on function public.ledger_no_truncate() from public, anon, authenticated;
revoke all on function public.journal_lines_only_in_creating_txn() from public, anon, authenticated;
revoke all on function public.accounts_guard() from public, anon, authenticated;
