-- Stage D5 (applied as Supabase migration "stage_d5_equipment_funding_and_chart_cleanup").
-- 1. One equipment acquisition with one or more funding sources -> ONE balanced journal entry:
--      Dr Equipment (total cost) / Cr each source: bank account, credit card, Owner Contributions (paid personally), new loan.
--    Replaces the three special-case functions (record_equipment_purchase / update_equipment_purchase / record_financed_equipment).
-- 2. Removes the generic "Loans Payable" and "Credit Cards Payable" system accounts (every loan and card has its own account).
-- Negative bank balances and card credit balances are never rejected by posting.

-- ===== chart cleanup =====
do $$ begin
  if exists (select 1 from public.accounts where system_key in ('loans_payable', 'credit_cards_payable')) then
    raise exception 'refusing to drop generic system accounts that already exist for a user';
  end if;
end $$;

create or replace function public.seed_chart_of_accounts(p_user uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('coa:' || p_user::text, 0));

  insert into public.accounts (user_id, name, type, system_key) values
    (p_user, 'Accounts Receivable',     'asset',     'accounts_receivable'),
    (p_user, 'Equipment',               'asset',     'equipment'),
    (p_user, 'Owner Contributions',     'equity',    'owner_contributions'),
    (p_user, 'Owner Draws',             'equity',    'owner_draws'),
    (p_user, 'Opening Balance Equity',  'equity',    'opening_balance_equity'),
    (p_user, 'Income',                  'income',    'income'),
    (p_user, 'Interest Expense',        'expense',   'interest_expense'),
    (p_user, 'Uncategorized Expense',   'expense',   'uncategorized_expense')
  on conflict do nothing;

  insert into public.accounts (user_id, name, type)
  select p_user, btrim(c.name), 'expense'
  from public.expense_categories c
  where c.user_id = p_user and length(btrim(c.name)) > 0
  on conflict do nothing;

  insert into public.accounts (user_id, name, type, bank_account_id)
  select p_user,
         case when exists (select 1 from public.accounts x where x.user_id = p_user and lower(x.name) = lower(
                 b.name || case when coalesce(b.last4,'') <> '' then ' (' || b.last4 || ')' else '' end))
              then b.name || ' (' || substr(b.id, 1, 6) || ')'
              else b.name || case when coalesce(b.last4,'') <> '' then ' (' || b.last4 || ')' else '' end end,
         case when lower(coalesce(b.subtype,'')) in ('credit card','credit') then 'liability' else 'asset' end,
         b.id
  from public.bank_accounts b
  where b.user_id = p_user
    and not exists (select 1 from public.accounts a where a.bank_account_id = b.id)
  on conflict do nothing;
end $$;

-- ===== equipment: funding sources =====
drop function if exists public.record_equipment_purchase(text, date, bigint, uuid, text);
drop function if exists public.update_equipment_purchase(uuid, text, date, bigint, uuid, text);
drop function if exists public.record_financed_equipment(text, date, bigint, text, integer, text);

alter table public.fixed_assets drop column paid_from_account_id, drop column loan_id;

create table public.fixed_asset_funding (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  asset_id uuid not null,
  kind text not null check (kind in ('account', 'owner', 'loan')),
  account_id uuid,
  loan_id uuid,
  amount_cents bigint not null check (amount_cents > 0),
  created_at timestamptz not null default now(),
  constraint fixed_asset_funding_asset_fkey foreign key (asset_id, user_id) references public.fixed_assets (id, user_id),
  constraint fixed_asset_funding_account_fkey foreign key (account_id, user_id) references public.accounts (id, user_id),
  constraint fixed_asset_funding_loan_fkey foreign key (loan_id, user_id) references public.loans (id, user_id),
  constraint fixed_asset_funding_shape check (
    (kind = 'account' and account_id is not null and loan_id is null) or
    (kind = 'owner'   and account_id is null     and loan_id is null) or
    (kind = 'loan'    and account_id is null     and loan_id is not null))
);
create unique index fixed_asset_funding_one_asset_per_loan on public.fixed_asset_funding (loan_id) where loan_id is not null;
alter table public.fixed_asset_funding enable row level security;
create policy fixed_asset_funding_select_own on public.fixed_asset_funding for select to authenticated using (auth.uid() = user_id);
revoke all on public.fixed_asset_funding from public, anon, authenticated;
grant select on public.fixed_asset_funding to authenticated;

-- credits: one entry per source account; debits: Equipment for the full cost
create or replace function public._asset_legs(p_asset uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare a public.fixed_assets; eq uuid; oc uuid; cr jsonb;
begin
  select * into a from public.fixed_assets where id = p_asset;
  select id into eq from public.accounts where user_id = a.user_id and system_key = 'equipment';
  select id into oc from public.accounts where user_id = a.user_id and system_key = 'owner_contributions';
  select coalesce(jsonb_object_agg(k, s), '{}'::jsonb) into cr from (
    select (case f.kind when 'account' then f.account_id when 'owner' then oc else l.account_id end)::text as k, sum(f.amount_cents) as s
    from public.fixed_asset_funding f left join public.loans l on l.id = f.loan_id
    where f.asset_id = p_asset group by 1) x;
  return jsonb_build_object('d', jsonb_build_object(eq::text, a.cost_cents), 'c', cr);
end $$;

create or replace function public._check_loan(p_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare l public.loans; paid bigint; live boolean; n int;
begin
  select * into l from public.loans where id = p_id;
  if not found then return; end if;
  perform pg_advisory_xact_lock(hashtextextended(l.user_id::text || '|loan-bal|' || l.id::text, 3));
  live := l.voided_at is null;
  select coalesce(sum(principal_cents), 0) into paid from public.loan_payments where loan_id = l.id and voided_at is null;
  if not live and exists (select 1 from public.loan_payments where loan_id = l.id and voided_at is null) then
    raise exception 'a voided loan cannot have live payments' using errcode = '23514';
  end if;
  if live and paid > l.principal_cents then
    raise exception 'principal paid (%) exceeds the loan amount (%)', paid, l.principal_cents using errcode = '23514';
  end if;
  if l.origin = 'cash' then
    perform public._check_event(l.user_id, 'loan', l.id::text, live, l.opened_date,
      jsonb_build_object(l.proceeds_account_id::text, l.principal_cents), jsonb_build_object(l.account_id::text, l.principal_cents));
  else
    if public._active_entry(l.user_id, 'loan', l.id::text) is not null then
      raise exception 'a financed-equipment loan has no cash entry of its own' using errcode = '23514';
    end if;
    select count(*) into n from public.fixed_asset_funding f join public.fixed_assets a on a.id = f.asset_id
     where f.loan_id = l.id and a.voided_at is null and f.amount_cents = l.principal_cents and a.acquired_date = l.opened_date;
    if live and n <> 1 then raise exception 'a financed loan must match exactly one live piece of equipment' using errcode = '23514'; end if;
    if not live and exists (select 1 from public.fixed_asset_funding f join public.fixed_assets a on a.id = f.asset_id where f.loan_id = l.id and a.voided_at is null) then
      raise exception 'void the equipment together with its loan' using errcode = '23514';
    end if;
  end if;
end $$;

create or replace function public._check_fixed_asset(p_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.fixed_assets; live boolean; total bigint; r record; l public.loans; g jsonb;
begin
  select * into a from public.fixed_assets where id = p_id;
  if not found then return; end if;
  live := a.voided_at is null;
  select coalesce(sum(amount_cents), 0) into total from public.fixed_asset_funding where asset_id = a.id;
  if total <> a.cost_cents then
    raise exception 'the funding sources (%) must add up to the equipment cost (%)', total, a.cost_cents using errcode = '23514';
  end if;
  for r in select f.*, ac.type as ac_type, ac.system_key as ac_key, ac.bank_account_id as ac_bank
           from public.fixed_asset_funding f left join public.accounts ac on ac.id = f.account_id where f.asset_id = a.id
  loop
    if r.kind = 'account' and (r.ac_key is not null or r.ac_bank is null or r.ac_type not in ('asset', 'liability')) then
      raise exception 'equipment can only be paid from a real bank account or credit card' using errcode = '23514';
    end if;
    if r.kind = 'loan' then
      select * into l from public.loans where id = r.loan_id;
      if l.origin <> 'financed_asset' or l.principal_cents <> r.amount_cents or l.opened_date <> a.acquired_date or ((l.voided_at is null) <> live) then
        raise exception 'the financing loan must match the equipment (amount, date, and live/voided together)' using errcode = '23514';
      end if;
    end if;
  end loop;
  g := public._asset_legs(a.id);
  perform public._check_event(a.user_id, 'equipment', a.id::text, live, a.acquired_date, g->'d', g->'c');
  for r in select loan_id from public.fixed_asset_funding where asset_id = a.id and loan_id is not null loop
    perform public._check_loan(r.loan_id);
  end loop;
end $$;

create or replace function public._tg_fixed_asset_funding_check() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin perform public._check_fixed_asset(coalesce(new.asset_id, old.asset_id)); return null; end $$;
create constraint trigger fixed_asset_funding_check after insert or update or delete on public.fixed_asset_funding
  deferrable initially deferred for each row execute function public._tg_fixed_asset_funding_check();

create or replace function public._sync_asset_posting(p_user uuid, p_id uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.fixed_assets; g jsonb;
begin
  select * into a from public.fixed_assets where id = p_id and user_id = p_user;
  if not found then raise exception 'equipment not found' using errcode = 'P0002'; end if;
  g := public._asset_legs(a.id);
  return public._sync_event(p_user, 'equipment', a.id::text, a.voided_at is null, a.acquired_date, 'Equipment: ' || a.name, g->'d', g->'c');
end $$;

create or replace function public._require_funding_account(p_user uuid, p_account uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.accounts;
begin
  select * into a from public.accounts where id = p_account and user_id = p_user;
  if not found or not a.is_active or a.system_key is not null or a.bank_account_id is null or a.type not in ('asset', 'liability') then
    raise exception 'choose a bank account or credit card for each part of the payment' using errcode = '23514';
  end if;
end $$;

-- p_funding: [{"kind":"account","account_id":"...","amount_cents":N}, {"kind":"owner","amount_cents":N},
--             {"kind":"loan","name":"...","lender":"...","interest_rate_bps":N,"amount_cents":N,"loan_id":"(existing, edits only)"}]
create or replace function public._write_equipment(p_user uuid, p_id uuid, p_name text, p_date date, p_cost bigint, p_funding jsonb, p_notes text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare aid uuid := p_id; f jsonb; total bigint := 0; amt bigint; k text; lid uuid; acct uuid; nm text;
        old_ids uuid[] := '{}'; keep uuid[] := '{}'; old_id uuid; l public.loans;
begin
  if coalesce(btrim(p_name), '') = '' then raise exception 'the equipment needs a name' using errcode = '23514'; end if;
  if p_cost is null or p_cost <= 0 then raise exception 'cost must be greater than zero' using errcode = '23514'; end if;
  if p_date is null then raise exception 'a date is required' using errcode = '23514'; end if;
  if p_funding is null or jsonb_typeof(p_funding) <> 'array' or jsonb_array_length(p_funding) = 0 then
    raise exception 'say how the equipment was paid for' using errcode = '23514';
  end if;

  if aid is null then
    insert into public.fixed_assets (user_id, name, acquired_date, cost_cents, notes) values (p_user, btrim(p_name), p_date, p_cost, p_notes) returning id into aid;
  else
    old_ids := array(select loan_id from public.fixed_asset_funding where asset_id = aid and loan_id is not null);
    update public.fixed_assets set name = btrim(p_name), acquired_date = p_date, cost_cents = p_cost, notes = p_notes where id = aid;
    delete from public.fixed_asset_funding where asset_id = aid;
  end if;

  for f in select * from jsonb_array_elements(p_funding) loop
    k := f->>'kind';
    amt := (f->>'amount_cents')::bigint;
    if amt is null or amt <= 0 then raise exception 'each funding amount must be greater than zero' using errcode = '23514'; end if;
    total := total + amt;
    if k = 'account' then
      acct := (f->>'account_id')::uuid;
      perform public._require_funding_account(p_user, acct);
      insert into public.fixed_asset_funding (user_id, asset_id, kind, account_id, amount_cents) values (p_user, aid, 'account', acct, amt);
    elsif k = 'owner' then
      insert into public.fixed_asset_funding (user_id, asset_id, kind, amount_cents) values (p_user, aid, 'owner', amt);
    elsif k = 'loan' then
      nm := btrim(coalesce(f->>'name', ''));
      if nm = '' then raise exception 'the financing needs a name' using errcode = '23514'; end if;
      lid := nullif(f->>'loan_id', '')::uuid;
      if lid is null then
        acct := public._new_loan_account(p_user, nm);
        insert into public.loans (user_id, name, lender, origin, principal_cents, opened_date, interest_rate_bps, account_id, notes)
        values (p_user, nm, f->>'lender', 'financed_asset', amt, p_date, nullif(f->>'interest_rate_bps', '')::int, acct, p_notes) returning id into lid;
      else
        if not (lid = any(old_ids)) then raise exception 'that loan does not belong to this equipment' using errcode = '23514'; end if;
        select * into l from public.loans where id = lid;
        if l.name <> nm then
          begin update public.accounts set name = 'Loan - ' || nm where id = l.account_id;
          exception when unique_violation then raise exception 'an account named "Loan - %" already exists; choose a different loan name', nm using errcode = '23505'; end;
        end if;
        update public.loans set name = nm, lender = f->>'lender', principal_cents = amt, opened_date = p_date,
          interest_rate_bps = nullif(f->>'interest_rate_bps', '')::int, notes = p_notes where id = lid;
      end if;
      keep := keep || lid;
      insert into public.fixed_asset_funding (user_id, asset_id, kind, loan_id, amount_cents) values (p_user, aid, 'loan', lid, amt);
    else
      raise exception 'unknown funding source "%"', k using errcode = '23514';
    end if;
  end loop;
  if total <> p_cost then
    raise exception 'the funding sources (%) must add up to the equipment cost (%)', total, p_cost using errcode = '23514';
  end if;

  -- financing that is no longer part of this acquisition is voided (only if nothing has been paid on it)
  for old_id in select unnest(old_ids) except select unnest(keep) loop
    if exists (select 1 from public.loan_payments where loan_id = old_id and voided_at is null) then
      raise exception 'void the payments on that financing before removing it' using errcode = '23514';
    end if;
    update public.loans set voided_at = now() where id = old_id;
    update public.accounts set is_active = false where id = (select account_id from public.loans where id = old_id);
  end loop;

  perform public._sync_asset_posting(p_user, aid);
  return aid;
end $$;

create or replace function public.record_equipment(p_name text, p_date date, p_cost_cents bigint, p_funding jsonb, p_notes text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'not signed in' using errcode = '28000'; end if;
  perform public.seed_chart_of_accounts(u);
  return public._write_equipment(u, null, p_name, p_date, p_cost_cents, p_funding, p_notes);
end $$;

create or replace function public.update_equipment(p_id uuid, p_name text, p_date date, p_cost_cents bigint, p_funding jsonb, p_notes text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := auth.uid(); a public.fixed_assets;
begin
  if u is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select * into a from public.fixed_assets where id = p_id and user_id = u for update;
  if not found then raise exception 'equipment not found' using errcode = 'P0002'; end if;
  if a.voided_at is not null then raise exception 'voided equipment cannot be edited' using errcode = '23514'; end if;
  return public._write_equipment(u, a.id, p_name, p_date, p_cost_cents, p_funding, p_notes);
end $$;

create or replace function public.void_fixed_asset(p_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := auth.uid(); a public.fixed_assets; r record;
begin
  if u is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select * into a from public.fixed_assets where id = p_id and user_id = u for update;
  if not found then raise exception 'equipment not found' using errcode = 'P0002'; end if;
  if a.voided_at is not null then return; end if;
  for r in select f.loan_id, l.account_id from public.fixed_asset_funding f join public.loans l on l.id = f.loan_id where f.asset_id = a.id loop
    if exists (select 1 from public.loan_payments where loan_id = r.loan_id and voided_at is null) then
      raise exception 'void this loan''s payments first' using errcode = '23514';
    end if;
    update public.loans set voided_at = now() where id = r.loan_id;
    update public.accounts set is_active = false where id = r.account_id;
  end loop;
  update public.fixed_assets set voided_at = now() where id = a.id;
  perform public._sync_asset_posting(u, a.id);
end $$;

do $$
declare f text;
begin
  foreach f in array array['_asset_legs(uuid)', '_tg_fixed_asset_funding_check()', '_require_funding_account(uuid,uuid)',
    '_write_equipment(uuid,uuid,text,date,bigint,jsonb,text)']
  loop execute format('revoke all on function public.%s from public, anon, authenticated', f); end loop;
  foreach f in array array['record_equipment(text,date,bigint,jsonb,text)', 'update_equipment(uuid,text,date,bigint,jsonb,text)']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
