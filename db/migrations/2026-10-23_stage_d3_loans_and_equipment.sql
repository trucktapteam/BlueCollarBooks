-- Stage D3 (applied as Supabase migration "stage_d3_loans_and_equipment").
-- Loans (cash proceeds), loan payments (explicit principal / interest split), equipment purchases (paid from a
-- bank account) and financed equipment (asset + loan, no cash and no expense).
-- Every loan gets its own liability account ("Loan - <name>") so its remaining principal is simply that account's balance.
-- The principal/interest split is always entered by the user: nothing is amortized or guessed.

create table public.loans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  lender text,
  origin text not null check (origin in ('cash', 'financed_asset')),
  principal_cents bigint not null check (principal_cents > 0),
  opened_date date not null check (opened_date between '2000-01-01' and '2100-12-31'),
  interest_rate_bps integer check (interest_rate_bps is null or interest_rate_bps between 0 and 100000),
  account_id uuid not null,
  proceeds_account_id uuid,
  notes text,
  voided_at timestamptz,
  created_at timestamptz not null default now(),
  constraint loans_id_user_unique unique (id, user_id),
  constraint loans_account_unique unique (account_id),
  constraint loans_account_owner_fkey foreign key (account_id, user_id) references public.accounts (id, user_id),
  constraint loans_proceeds_owner_fkey foreign key (proceeds_account_id, user_id) references public.accounts (id, user_id),
  constraint loans_origin_proceeds check ((origin = 'cash') = (proceeds_account_id is not null))
);

create table public.loan_payments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  loan_id uuid not null,
  payment_date date not null check (payment_date between '2000-01-01' and '2100-12-31'),
  principal_cents bigint not null default 0 check (principal_cents >= 0),
  interest_cents bigint not null default 0 check (interest_cents >= 0),
  paid_from_account_id uuid not null,
  notes text,
  voided_at timestamptz,
  created_at timestamptz not null default now(),
  constraint loan_payments_id_user_unique unique (id, user_id),
  constraint loan_payments_total_positive check (principal_cents + interest_cents > 0),
  constraint loan_payments_loan_owner_fkey foreign key (loan_id, user_id) references public.loans (id, user_id),
  constraint loan_payments_paid_from_owner_fkey foreign key (paid_from_account_id, user_id) references public.accounts (id, user_id)
);

create table public.fixed_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(btrim(name)) > 0),
  acquired_date date not null check (acquired_date between '2000-01-01' and '2100-12-31'),
  cost_cents bigint not null check (cost_cents > 0),
  paid_from_account_id uuid,
  loan_id uuid,
  notes text,
  voided_at timestamptz,
  created_at timestamptz not null default now(),
  constraint fixed_assets_id_user_unique unique (id, user_id),
  constraint fixed_assets_one_funding check ((paid_from_account_id is null) <> (loan_id is null)),
  constraint fixed_assets_paid_from_owner_fkey foreign key (paid_from_account_id, user_id) references public.accounts (id, user_id),
  constraint fixed_assets_loan_owner_fkey foreign key (loan_id, user_id) references public.loans (id, user_id)
);

do $$
declare t text;
begin
  foreach t in array array['loans', 'loan_payments', 'fixed_assets'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (auth.uid() = user_id)', t || '_select_own', t);
    execute format('revoke all on public.%I from public, anon, authenticated', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

-- ===== commit-time checks =====
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
    select count(*) into n from public.fixed_assets a
     where a.loan_id = l.id and a.voided_at is null and a.cost_cents = l.principal_cents and a.acquired_date = l.opened_date;
    if live and n <> 1 then raise exception 'a financed loan must match exactly one live piece of equipment' using errcode = '23514'; end if;
    if not live and exists (select 1 from public.fixed_assets a where a.loan_id = l.id and a.voided_at is null) then
      raise exception 'void the equipment together with its loan' using errcode = '23514';
    end if;
  end if;
end $$;

create or replace function public._loan_payment_legs(p public.loan_payments, l public.loans)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare ia uuid;
begin
  select id into ia from public.accounts where user_id = p.user_id and system_key = 'interest_expense';
  return jsonb_build_object(
    'd', jsonb_build_object(l.account_id::text, nullif(p.principal_cents, 0), ia::text, nullif(p.interest_cents, 0)),
    'c', jsonb_build_object(p.paid_from_account_id::text, p.principal_cents + p.interest_cents));
end $$;

create or replace function public._check_loan_payment(p_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.loan_payments; l public.loans; g jsonb; live boolean;
begin
  select * into p from public.loan_payments where id = p_id;
  if not found then return; end if;
  select * into l from public.loans where id = p.loan_id;
  live := p.voided_at is null;
  if live and l.voided_at is not null then raise exception 'a live payment cannot belong to a voided loan' using errcode = '23514'; end if;
  if live and p.payment_date < l.opened_date then raise exception 'a loan payment cannot be dated before the loan' using errcode = '23514'; end if;
  g := public._loan_payment_legs(p, l);
  perform public._check_event(p.user_id, 'loan_payment', p.id::text, live, p.payment_date, g->'d', g->'c');
  perform public._check_loan(p.loan_id);
end $$;

create or replace function public._check_fixed_asset(p_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.fixed_assets; l public.loans; eq uuid; live boolean;
begin
  select * into a from public.fixed_assets where id = p_id;
  if not found then return; end if;
  live := a.voided_at is null;
  select id into eq from public.accounts where user_id = a.user_id and system_key = 'equipment';
  if a.loan_id is not null then
    select * into l from public.loans where id = a.loan_id;
    if (l.voided_at is null) <> live then raise exception 'equipment and its financing loan must be live or voided together' using errcode = '23514'; end if;
    perform public._check_event(a.user_id, 'equipment', a.id::text, live, a.acquired_date,
      jsonb_build_object(eq::text, a.cost_cents), jsonb_build_object(l.account_id::text, a.cost_cents));
    perform public._check_loan(a.loan_id);
  else
    perform public._check_event(a.user_id, 'equipment', a.id::text, live, a.acquired_date,
      jsonb_build_object(eq::text, a.cost_cents), jsonb_build_object(a.paid_from_account_id::text, a.cost_cents));
  end if;
end $$;

create or replace function public._tg_loan_check() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin perform public._check_loan(new.id); return null; end $$;
create or replace function public._tg_loan_payment_check() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin perform public._check_loan_payment(new.id); return null; end $$;
create or replace function public._tg_fixed_asset_check() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin perform public._check_fixed_asset(new.id); return null; end $$;
create constraint trigger loans_check after insert or update on public.loans deferrable initially deferred for each row execute function public._tg_loan_check();
create constraint trigger loan_payments_check after insert or update on public.loan_payments deferrable initially deferred for each row execute function public._tg_loan_payment_check();
create constraint trigger fixed_assets_check after insert or update on public.fixed_assets deferrable initially deferred for each row execute function public._tg_fixed_asset_check();

-- Live (unvoided) rows cannot be deleted; void them instead.
create or replace function public._block_delete_when_live() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from auth.users u where u.id = old.user_id) and old.voided_at is null then
    raise exception '% is posted to the books; void it instead of deleting', tg_table_name using errcode = '23503';
  end if;
  return old;
end $$;
create trigger loans_block_delete before delete on public.loans for each row execute function public._block_delete_when_live();
create trigger loan_payments_block_delete before delete on public.loan_payments for each row execute function public._block_delete_when_live();
create trigger fixed_assets_block_delete before delete on public.fixed_assets for each row execute function public._block_delete_when_live();

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
    else null;
  end case;
  return null;
end $$;

-- ===== posting =====
create or replace function public._sync_loan_posting(p_user uuid, p_id uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare l public.loans;
begin
  select * into l from public.loans where id = p_id and user_id = p_user;
  if not found then raise exception 'loan not found' using errcode = 'P0002'; end if;
  if l.origin <> 'cash' then return null; end if;
  return public._sync_event(p_user, 'loan', l.id::text, l.voided_at is null, l.opened_date, 'Loan received: ' || l.name,
    jsonb_build_object(l.proceeds_account_id::text, l.principal_cents), jsonb_build_object(l.account_id::text, l.principal_cents));
end $$;

create or replace function public._sync_loan_payment_posting(p_user uuid, p_id uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.loan_payments; l public.loans; g jsonb;
begin
  select * into p from public.loan_payments where id = p_id and user_id = p_user;
  if not found then raise exception 'loan payment not found' using errcode = 'P0002'; end if;
  select * into l from public.loans where id = p.loan_id;
  g := public._loan_payment_legs(p, l);
  return public._sync_event(p_user, 'loan_payment', p.id::text, p.voided_at is null, p.payment_date, 'Loan payment: ' || l.name, g->'d', g->'c');
end $$;

create or replace function public._sync_asset_posting(p_user uuid, p_id uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare a public.fixed_assets; l public.loans; eq uuid; src uuid;
begin
  select * into a from public.fixed_assets where id = p_id and user_id = p_user;
  if not found then raise exception 'equipment not found' using errcode = 'P0002'; end if;
  select id into eq from public.accounts where user_id = p_user and system_key = 'equipment';
  if a.loan_id is not null then select account_id into src from public.loans where id = a.loan_id; else src := a.paid_from_account_id; end if;
  return public._sync_event(p_user, 'equipment', a.id::text, a.voided_at is null, a.acquired_date, 'Equipment: ' || a.name,
    jsonb_build_object(eq::text, a.cost_cents), jsonb_build_object(src::text, a.cost_cents));
end $$;

create or replace function public._new_loan_account(p_user uuid, p_name text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare new_id uuid;
begin
  insert into public.accounts (user_id, name, type) values (p_user, 'Loan - ' || btrim(p_name), 'liability') returning accounts.id into new_id;
  return new_id;
exception when unique_violation then
  raise exception 'an account named "Loan - %" already exists; choose a different loan name', btrim(p_name) using errcode = '23505';
end $$;

-- ===== public API: loans =====
create or replace function public.record_loan(p_name text, p_lender text, p_principal_cents bigint, p_opened_date date, p_proceeds_account_id uuid,
  p_interest_rate_bps integer default null, p_notes text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := auth.uid(); acct uuid; lid uuid;
begin
  if u is null then raise exception 'not signed in' using errcode = '28000'; end if;
  perform public.seed_chart_of_accounts(u);
  if coalesce(btrim(p_name), '') = '' then raise exception 'the loan needs a name' using errcode = '23514'; end if;
  if p_principal_cents is null or p_principal_cents <= 0 then raise exception 'loan amount must be greater than zero' using errcode = '23514'; end if;
  if p_opened_date is null then raise exception 'the loan needs a date' using errcode = '23514'; end if;
  perform public._require_account(u, p_proceeds_account_id, 'bank', 'choose the bank account the loan money was deposited into');
  acct := public._new_loan_account(u, p_name);
  insert into public.loans (user_id, name, lender, origin, principal_cents, opened_date, interest_rate_bps, account_id, proceeds_account_id, notes)
  values (u, btrim(p_name), p_lender, 'cash', p_principal_cents, p_opened_date, p_interest_rate_bps, acct, p_proceeds_account_id, p_notes) returning id into lid;
  perform public._sync_loan_posting(u, lid);
  return lid;
end $$;

create or replace function public.update_loan(p_id uuid, p_name text, p_lender text, p_principal_cents bigint, p_opened_date date, p_proceeds_account_id uuid,
  p_interest_rate_bps integer default null, p_notes text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := auth.uid(); l public.loans;
begin
  if u is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select * into l from public.loans where id = p_id and user_id = u for update;
  if not found then raise exception 'loan not found' using errcode = 'P0002'; end if;
  if l.voided_at is not null then raise exception 'a voided loan cannot be edited' using errcode = '23514'; end if;
  if l.origin <> 'cash' then raise exception 'financed equipment loans are changed by voiding the equipment and entering it again' using errcode = '23514'; end if;
  if exists (select 1 from public.loan_payments where loan_id = l.id and voided_at is null) then
    raise exception 'void this loan''s payments before changing the loan' using errcode = '23514';
  end if;
  if coalesce(btrim(p_name), '') = '' then raise exception 'the loan needs a name' using errcode = '23514'; end if;
  if p_principal_cents is null or p_principal_cents <= 0 then raise exception 'loan amount must be greater than zero' using errcode = '23514'; end if;
  if p_opened_date is null then raise exception 'the loan needs a date' using errcode = '23514'; end if;
  perform public._require_account(u, p_proceeds_account_id, 'bank', 'choose the bank account the loan money was deposited into');
  if btrim(p_name) <> l.name then
    begin update public.accounts set name = 'Loan - ' || btrim(p_name) where id = l.account_id;
    exception when unique_violation then raise exception 'an account named "Loan - %" already exists; choose a different loan name', btrim(p_name) using errcode = '23505'; end;
  end if;
  update public.loans set name = btrim(p_name), lender = p_lender, principal_cents = p_principal_cents, opened_date = p_opened_date,
    proceeds_account_id = p_proceeds_account_id, interest_rate_bps = p_interest_rate_bps, notes = p_notes where id = l.id;
  perform public._sync_loan_posting(u, l.id);
  return l.id;
end $$;

create or replace function public.void_loan(p_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := auth.uid(); l public.loans;
begin
  if u is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select * into l from public.loans where id = p_id and user_id = u for update;
  if not found then raise exception 'loan not found' using errcode = 'P0002'; end if;
  if l.voided_at is not null then return; end if;
  if l.origin <> 'cash' then raise exception 'void the equipment instead; its loan is voided with it' using errcode = '23514'; end if;
  if exists (select 1 from public.loan_payments where loan_id = l.id and voided_at is null) then
    raise exception 'void this loan''s payments first' using errcode = '23514';
  end if;
  update public.loans set voided_at = now() where id = l.id;
  update public.accounts set is_active = false where id = l.account_id;
  perform public._sync_loan_posting(u, l.id);
end $$;

-- ===== public API: loan payments =====
create or replace function public._write_loan_payment(p_user uuid, p_id uuid, p_loan uuid, p_date date, p_principal bigint, p_interest bigint, p_from uuid, p_notes text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare l public.loans; pid uuid := p_id; paid bigint;
begin
  select * into l from public.loans where id = p_loan and user_id = p_user for update;
  if not found then raise exception 'loan not found' using errcode = 'P0002'; end if;
  if l.voided_at is not null then raise exception 'this loan has been voided' using errcode = '23514'; end if;
  if p_principal is null or p_interest is null or p_principal < 0 or p_interest < 0 or p_principal + p_interest <= 0 then
    raise exception 'enter the principal and interest parts of the payment (neither can be negative, and the total must be greater than zero)' using errcode = '23514';
  end if;
  if p_date is null then raise exception 'a date is required' using errcode = '23514'; end if;
  if p_date < l.opened_date then raise exception 'a loan payment cannot be dated before the loan' using errcode = '23514'; end if;
  perform public._require_account(p_user, p_from, 'bank', 'choose the bank account the loan payment was paid from');
  select coalesce(sum(principal_cents), 0) into paid from public.loan_payments where loan_id = l.id and voided_at is null and id is distinct from p_id;
  if paid + p_principal > l.principal_cents then
    raise exception 'the principal part (%) is more than the loan has left to pay (%)', p_principal, l.principal_cents - paid using errcode = '23514';
  end if;
  if pid is null then
    insert into public.loan_payments (user_id, loan_id, payment_date, principal_cents, interest_cents, paid_from_account_id, notes)
    values (p_user, l.id, p_date, p_principal, p_interest, p_from, p_notes) returning id into pid;
  else
    update public.loan_payments set payment_date = p_date, principal_cents = p_principal, interest_cents = p_interest,
      paid_from_account_id = p_from, notes = p_notes where id = pid;
  end if;
  perform public._sync_loan_payment_posting(p_user, pid);
  return pid;
end $$;

create or replace function public.record_loan_payment(p_loan_id uuid, p_date date, p_principal_cents bigint, p_interest_cents bigint, p_paid_from_account_id uuid, p_notes text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'not signed in' using errcode = '28000'; end if;
  perform public.seed_chart_of_accounts(u);
  return public._write_loan_payment(u, null, p_loan_id, p_date, p_principal_cents, p_interest_cents, p_paid_from_account_id, p_notes);
end $$;

create or replace function public.update_loan_payment(p_id uuid, p_date date, p_principal_cents bigint, p_interest_cents bigint, p_paid_from_account_id uuid, p_notes text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := auth.uid(); p public.loan_payments;
begin
  if u is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select * into p from public.loan_payments where id = p_id and user_id = u for update;
  if not found then raise exception 'loan payment not found' using errcode = 'P0002'; end if;
  if p.voided_at is not null then raise exception 'a voided loan payment cannot be edited' using errcode = '23514'; end if;
  return public._write_loan_payment(u, p.id, p.loan_id, p_date, p_principal_cents, p_interest_cents, p_paid_from_account_id, p_notes);
end $$;

create or replace function public.void_loan_payment(p_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := auth.uid(); p public.loan_payments;
begin
  if u is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select * into p from public.loan_payments where id = p_id and user_id = u for update;
  if not found then raise exception 'loan payment not found' using errcode = 'P0002'; end if;
  if p.voided_at is not null then return; end if;
  update public.loan_payments set voided_at = now() where id = p.id;
  perform public._sync_loan_payment_posting(u, p.id);
end $$;

-- ===== public API: equipment =====
create or replace function public.record_equipment_purchase(p_name text, p_date date, p_cost_cents bigint, p_paid_from_account_id uuid, p_notes text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := auth.uid(); aid uuid;
begin
  if u is null then raise exception 'not signed in' using errcode = '28000'; end if;
  perform public.seed_chart_of_accounts(u);
  if coalesce(btrim(p_name), '') = '' then raise exception 'the equipment needs a name' using errcode = '23514'; end if;
  if p_cost_cents is null or p_cost_cents <= 0 then raise exception 'cost must be greater than zero' using errcode = '23514'; end if;
  if p_date is null then raise exception 'a date is required' using errcode = '23514'; end if;
  perform public._require_account(u, p_paid_from_account_id, 'bank', 'choose the bank account the equipment was paid from');
  insert into public.fixed_assets (user_id, name, acquired_date, cost_cents, paid_from_account_id, notes)
  values (u, btrim(p_name), p_date, p_cost_cents, p_paid_from_account_id, p_notes) returning id into aid;
  perform public._sync_asset_posting(u, aid);
  return aid;
end $$;

create or replace function public.update_equipment_purchase(p_id uuid, p_name text, p_date date, p_cost_cents bigint, p_paid_from_account_id uuid, p_notes text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := auth.uid(); a public.fixed_assets;
begin
  if u is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select * into a from public.fixed_assets where id = p_id and user_id = u for update;
  if not found then raise exception 'equipment not found' using errcode = 'P0002'; end if;
  if a.voided_at is not null then raise exception 'voided equipment cannot be edited' using errcode = '23514'; end if;
  if a.loan_id is not null then raise exception 'financed equipment is changed by voiding it and entering it again' using errcode = '23514'; end if;
  if coalesce(btrim(p_name), '') = '' then raise exception 'the equipment needs a name' using errcode = '23514'; end if;
  if p_cost_cents is null or p_cost_cents <= 0 then raise exception 'cost must be greater than zero' using errcode = '23514'; end if;
  if p_date is null then raise exception 'a date is required' using errcode = '23514'; end if;
  perform public._require_account(u, p_paid_from_account_id, 'bank', 'choose the bank account the equipment was paid from');
  update public.fixed_assets set name = btrim(p_name), acquired_date = p_date, cost_cents = p_cost_cents, paid_from_account_id = p_paid_from_account_id, notes = p_notes where id = a.id;
  perform public._sync_asset_posting(u, a.id);
  return a.id;
end $$;

-- Equipment bought with a loan: Dr Equipment / Cr the new loan. No cash moves and nothing is expensed.
create or replace function public.record_financed_equipment(p_name text, p_date date, p_cost_cents bigint, p_lender text default null,
  p_interest_rate_bps integer default null, p_notes text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := auth.uid(); acct uuid; lid uuid; aid uuid;
begin
  if u is null then raise exception 'not signed in' using errcode = '28000'; end if;
  perform public.seed_chart_of_accounts(u);
  if coalesce(btrim(p_name), '') = '' then raise exception 'the equipment needs a name' using errcode = '23514'; end if;
  if p_cost_cents is null or p_cost_cents <= 0 then raise exception 'cost must be greater than zero' using errcode = '23514'; end if;
  if p_date is null then raise exception 'a date is required' using errcode = '23514'; end if;
  acct := public._new_loan_account(u, p_name);
  insert into public.loans (user_id, name, lender, origin, principal_cents, opened_date, interest_rate_bps, account_id, notes)
  values (u, btrim(p_name), p_lender, 'financed_asset', p_cost_cents, p_date, p_interest_rate_bps, acct, p_notes) returning id into lid;
  insert into public.fixed_assets (user_id, name, acquired_date, cost_cents, loan_id, notes)
  values (u, btrim(p_name), p_date, p_cost_cents, lid, p_notes) returning id into aid;
  perform public._sync_asset_posting(u, aid);
  return aid;
end $$;

create or replace function public.void_fixed_asset(p_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := auth.uid(); a public.fixed_assets; l public.loans;
begin
  if u is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select * into a from public.fixed_assets where id = p_id and user_id = u for update;
  if not found then raise exception 'equipment not found' using errcode = 'P0002'; end if;
  if a.voided_at is not null then return; end if;
  if a.loan_id is not null then
    select * into l from public.loans where id = a.loan_id for update;
    if exists (select 1 from public.loan_payments where loan_id = l.id and voided_at is null) then
      raise exception 'void this loan''s payments first' using errcode = '23514';
    end if;
    update public.loans set voided_at = now() where id = l.id;
    update public.accounts set is_active = false where id = l.account_id;
  end if;
  update public.fixed_assets set voided_at = now() where id = a.id;
  perform public._sync_asset_posting(u, a.id);
end $$;

-- ===== privileges =====
do $$
declare f text;
begin
  foreach f in array array[
    '_check_loan(uuid)', '_loan_payment_legs(public.loan_payments,public.loans)', '_check_loan_payment(uuid)', '_check_fixed_asset(uuid)',
    '_tg_loan_check()', '_tg_loan_payment_check()', '_tg_fixed_asset_check()', '_block_delete_when_live()',
    '_sync_loan_posting(uuid,uuid)', '_sync_loan_payment_posting(uuid,uuid)', '_sync_asset_posting(uuid,uuid)', '_new_loan_account(uuid,text)',
    '_write_loan_payment(uuid,uuid,uuid,date,bigint,bigint,uuid,text)']
  loop execute format('revoke all on function public.%s from public, anon, authenticated', f); end loop;
  foreach f in array array[
    'record_loan(text,text,bigint,date,uuid,integer,text)', 'update_loan(uuid,text,text,bigint,date,uuid,integer,text)', 'void_loan(uuid)',
    'record_loan_payment(uuid,date,bigint,bigint,uuid,text)', 'update_loan_payment(uuid,date,bigint,bigint,uuid,text)', 'void_loan_payment(uuid)',
    'record_equipment_purchase(text,date,bigint,uuid,text)', 'update_equipment_purchase(uuid,text,date,bigint,uuid,text)',
    'record_financed_equipment(text,date,bigint,text,integer,text)', 'void_fixed_asset(uuid)']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
