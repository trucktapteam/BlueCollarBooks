-- Stage B4: posting functions (applied as Supabase migration "stage_b4_posting_functions").
-- All ledger writes happen here, inside Postgres, one transaction per business event.

-- Internal: write one balanced entry atomically.
create or replace function public._post_entry(p_user uuid, p_date date, p_memo text, p_source_type text, p_source_id text, p_lines jsonb)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare e uuid; l jsonb;
begin
  insert into public.journal_entries (user_id, entry_date, memo, source_type, source_id)
  values (p_user, p_date, p_memo, p_source_type, p_source_id) returning id into e;
  for l in select * from jsonb_array_elements(p_lines) loop
    insert into public.journal_lines (entry_id, user_id, account_id, debit_cents, credit_cents, memo)
    values (e, p_user, (l->>'account_id')::uuid, coalesce((l->>'debit')::bigint, 0), coalesce((l->>'credit')::bigint, 0), l->>'memo');
  end loop;
  perform public.validate_journal_entry(e);   -- fail now with a clear error (also re-checked at commit)
  return e;
end $$;

-- Internal: reverse one entry (same date/source, debits and credits swapped).
create or replace function public._reverse_entry(p_user uuid, p_entry uuid, p_memo text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare o public.journal_entries; r uuid;
begin
  select * into o from public.journal_entries where id = p_entry and user_id = p_user;
  if not found then raise exception 'journal entry not found' using errcode = 'P0002'; end if;
  if o.reverses_entry_id is not null then raise exception 'a reversal cannot itself be reversed' using errcode = '23514'; end if;
  if exists (select 1 from public.journal_entries x where x.reverses_entry_id = o.id) then
    raise exception 'journal entry is already reversed' using errcode = '23505';
  end if;
  insert into public.journal_entries (user_id, entry_date, memo, source_type, source_id, reverses_entry_id)
  values (p_user, o.entry_date, coalesce(p_memo, 'Reversal: ' || coalesce(o.memo, o.source_type)), o.source_type, o.source_id, o.id)
  returning id into r;
  insert into public.journal_lines (entry_id, user_id, account_id, debit_cents, credit_cents, memo)
  select r, p_user, account_id, credit_cents, debit_cents, memo from public.journal_lines where entry_id = o.id;
  perform public.validate_journal_entry(r);
  return r;
end $$;

-- Internal: the single active (unreversed, non-reversal) entry for a source, if any.
create or replace function public._active_entry(p_user uuid, p_source_type text, p_source_id text)
returns uuid language sql stable security definer set search_path = public, pg_temp as $$
  select e.id from public.journal_entries e
  where e.user_id = p_user and e.source_type = p_source_type and e.source_id = p_source_id
    and e.reverses_entry_id is null
    and not exists (select 1 from public.journal_entries r where r.reverses_entry_id = e.id)
  limit 1 $$;

-- Internal: post an expense from its source row.
create or replace function public._post_expense(p_user uuid, p_expense_id text, p_paid_from uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare x public.expenses; pf public.accounts; ea uuid; memo text;
begin
  select * into x from public.expenses where id = p_expense_id and user_id = p_user;
  if not found then raise exception 'expense not found' using errcode = 'P0002'; end if;
  if x.amount is null or x.amount <= 0 then raise exception 'expense amount must be greater than zero to post' using errcode = '23514'; end if;
  if x.date is null then raise exception 'expense needs a date to post' using errcode = '23514'; end if;

  select * into pf from public.accounts where id = p_paid_from and user_id = p_user;
  if not found or pf.type not in ('asset','liability') or not pf.is_active then
    raise exception 'choose a bank or credit-card account that the expense was paid from' using errcode = '23514';
  end if;

  select id into ea from public.accounts
   where user_id = p_user and type = 'expense' and lower(name) = lower(btrim(coalesce(x.category, ''))) limit 1;
  if ea is null then
    select id into ea from public.accounts where user_id = p_user and system_key = 'uncategorized_expense';
  end if;

  memo := x.vendor || case when coalesce(btrim(x.notes), '') <> '' then ' - ' || btrim(x.notes) else '' end;
  return public._post_entry(p_user, x.date, memo, 'expense', x.id, jsonb_build_array(
    jsonb_build_object('account_id', ea, 'debit', x.amount),
    jsonb_build_object('account_id', p_paid_from, 'credit', x.amount)));
end $$;

-- ===== Public API (signed-in users act only on their own data) =====

create or replace function public.post_opening_balance(p_account_id uuid, p_amount_cents bigint, p_as_of date)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := auth.uid(); a public.accounts; obe uuid; debit_acct boolean; amt bigint;
begin
  if u is null then raise exception 'not signed in' using errcode = '28000'; end if;
  perform public.seed_chart_of_accounts(u);
  select * into a from public.accounts where id = p_account_id and user_id = u;
  if not found then raise exception 'account not found' using errcode = 'P0002'; end if;
  if a.type not in ('asset','liability') then raise exception 'opening balances apply to asset and liability accounts only' using errcode = '23514'; end if;
  if p_amount_cents is null or p_amount_cents = 0 then raise exception 'opening balance must not be zero' using errcode = '23514'; end if;
  if p_as_of is null then raise exception 'opening balance needs a date' using errcode = '23514'; end if;
  perform pg_advisory_xact_lock(hashtextextended(u::text || '|opening_balance|' || a.id::text, 1));
  if public._active_entry(u, 'opening_balance', a.id::text) is not null then
    raise exception 'this account already has an opening balance; reverse it to change it' using errcode = '23505';
  end if;
  select id into obe from public.accounts where user_id = u and system_key = 'opening_balance_equity';
  amt := abs(p_amount_cents);
  debit_acct := (a.type = 'asset') = (p_amount_cents > 0);
  return public._post_entry(u, p_as_of, 'Opening balance: ' || a.name, 'opening_balance', a.id::text, jsonb_build_array(
    case when debit_acct then jsonb_build_object('account_id', a.id, 'debit', amt) else jsonb_build_object('account_id', a.id, 'credit', amt) end,
    case when debit_acct then jsonb_build_object('account_id', obe, 'credit', amt) else jsonb_build_object('account_id', obe, 'debit', amt) end));
end $$;

create or replace function public.post_expense(p_expense_id text, p_paid_from_account_id uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'not signed in' using errcode = '28000'; end if;
  perform public.seed_chart_of_accounts(u);
  perform pg_advisory_xact_lock(hashtextextended(u::text || '|expense|' || p_expense_id, 1));
  if public._active_entry(u, 'expense', p_expense_id) is not null then
    raise exception 'this expense is already posted; use repost_expense to change it' using errcode = '23505';
  end if;
  return public._post_expense(u, p_expense_id, p_paid_from_account_id);
end $$;

-- Edit = reverse the active entry and post a fresh one from the expense's current values, atomically.
-- p_paid_from_account_id may be null to keep the account the expense was previously paid from.
create or replace function public.repost_expense(p_expense_id text, p_paid_from_account_id uuid default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := auth.uid(); act uuid; pf uuid := p_paid_from_account_id;
begin
  if u is null then raise exception 'not signed in' using errcode = '28000'; end if;
  perform public.seed_chart_of_accounts(u);
  perform pg_advisory_xact_lock(hashtextextended(u::text || '|expense|' || p_expense_id, 1));
  act := public._active_entry(u, 'expense', p_expense_id);
  if act is not null then
    if pf is null then
      select account_id into pf from public.journal_lines where entry_id = act and credit_cents > 0 limit 1;
    end if;
    perform public._reverse_entry(u, act, 'Edited expense');
  end if;
  if pf is null then raise exception 'choose the account this expense was paid from' using errcode = '23514'; end if;
  return public._post_expense(u, p_expense_id, pf);
end $$;

create or replace function public.reverse_journal_entry(p_entry_id uuid, p_memo text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'not signed in' using errcode = '28000'; end if;
  return public._reverse_entry(u, p_entry_id, p_memo);
end $$;

-- Undo whatever is currently posted for a source document (e.g. when an expense is deleted). Returns null if nothing is posted.
create or replace function public.reverse_active_entry(p_source_type text, p_source_id text, p_memo text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := auth.uid(); act uuid;
begin
  if u is null then raise exception 'not signed in' using errcode = '28000'; end if;
  perform pg_advisory_xact_lock(hashtextextended(u::text || '|' || p_source_type || '|' || p_source_id, 1));
  act := public._active_entry(u, p_source_type, p_source_id);
  if act is null then return null; end if;
  return public._reverse_entry(u, act, p_memo);
end $$;

-- Privileges: internals are private; public API for signed-in users only.
revoke all on function public._post_entry(uuid,date,text,text,text,jsonb) from public, anon, authenticated;
revoke all on function public._reverse_entry(uuid,uuid,text) from public, anon, authenticated;
revoke all on function public._active_entry(uuid,text,text) from public, anon, authenticated;
revoke all on function public._post_expense(uuid,text,uuid) from public, anon, authenticated;
revoke all on function public.post_opening_balance(uuid,bigint,date) from public, anon;
revoke all on function public.post_expense(text,uuid) from public, anon;
revoke all on function public.repost_expense(text,uuid) from public, anon;
revoke all on function public.reverse_journal_entry(uuid,text) from public, anon;
revoke all on function public.reverse_active_entry(text,text,text) from public, anon;
grant execute on function public.post_opening_balance(uuid,bigint,date) to authenticated;
grant execute on function public.post_expense(text,uuid) to authenticated;
grant execute on function public.repost_expense(text,uuid) to authenticated;
grant execute on function public.reverse_journal_entry(uuid,text) to authenticated;
grant execute on function public.reverse_active_entry(text,text,text) to authenticated;

-- Follow-up migration "stage_b_pin_trigger_function_search_path"
alter function public.ledger_no_truncate() set search_path = public, pg_temp;
alter function public.journal_validate_from_line() set search_path = public, pg_temp;
alter function public.journal_validate_from_entry() set search_path = public, pg_temp;
