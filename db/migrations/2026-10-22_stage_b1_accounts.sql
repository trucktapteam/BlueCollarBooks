-- Stage B1: chart of accounts (applied as Supabase migration "stage_b1_accounts").
-- Written only by SECURITY DEFINER functions; users can read their own rows.
alter table public.bank_accounts add constraint bank_accounts_id_user_unique unique (id, user_id);

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  type text not null check (type in ('asset','liability','equity','income','expense')),
  system_key text,
  bank_account_id text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint accounts_id_user_unique unique (id, user_id),
  constraint accounts_name_not_blank check (length(btrim(name)) > 0),
  constraint accounts_bank_owner_fkey foreign key (bank_account_id, user_id)
    references public.bank_accounts (id, user_id) on delete set null (bank_account_id)
);
create unique index accounts_user_name_unique on public.accounts (user_id, lower(name));
create unique index accounts_user_system_key_unique on public.accounts (user_id, system_key) where system_key is not null;
create unique index accounts_bank_account_unique on public.accounts (bank_account_id) where bank_account_id is not null;

alter table public.accounts enable row level security;
create policy accounts_select_own on public.accounts for select to authenticated using (auth.uid() = user_id);
revoke all on public.accounts from public, anon, authenticated;
grant select on public.accounts to authenticated;

-- System accounts can't be renamed/retyped/deleted; no account can change type or owner.
create or replace function public.accounts_guard() returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if tg_op = 'UPDATE' then
    if new.user_id <> old.user_id or new.type <> old.type or new.system_key is distinct from old.system_key then
      raise exception 'account owner, type and system key cannot change' using errcode = '23514';
    end if;
    if old.system_key is not null and new.name <> old.name then
      raise exception 'system account "%" cannot be renamed', old.name using errcode = '23514';
    end if;
    return new;
  end if;
  -- DELETE: allowed only when the whole user is being deleted (parent row already gone).
  if old.system_key is not null and exists (select 1 from auth.users u where u.id = old.user_id) then
    raise exception 'system account "%" cannot be deleted', old.name using errcode = '23514';
  end if;
  return old;
end $$;
create trigger accounts_guard_trg before update or delete on public.accounts
  for each row execute function public.accounts_guard();

-- Idempotent seeding: system accounts, one expense account per expense category, one account per bank account.
create or replace function public.seed_chart_of_accounts(p_user uuid) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('coa:' || p_user::text, 0));

  insert into public.accounts (user_id, name, type, system_key) values
    (p_user, 'Accounts Receivable',     'asset',     'accounts_receivable'),
    (p_user, 'Equipment',               'asset',     'equipment'),
    (p_user, 'Loans Payable',           'liability', 'loans_payable'),
    (p_user, 'Credit Cards Payable',    'liability', 'credit_cards_payable'),
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
revoke all on function public.seed_chart_of_accounts(uuid) from public, anon, authenticated;

create or replace function public.ensure_chart_of_accounts() returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '28000'; end if;
  perform public.seed_chart_of_accounts(auth.uid());
end $$;
revoke all on function public.ensure_chart_of_accounts() from public, anon;
grant execute on function public.ensure_chart_of_accounts() to authenticated;
