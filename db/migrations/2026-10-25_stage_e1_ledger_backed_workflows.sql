-- Stage E1 (applied as Supabase migration "stage_e1_ledger_backed_workflows").
-- The database half of wiring the app to the ledger. Every workflow below is ONE transaction:
--   save_expense / delete_expense          expense row + its ledger entry ("Paid from" is required)
--   categorize_plaid_transaction           bank transaction -> expense, paid from the transaction's own connected account
--   save_invoice (now posts) / delete_invoice / set_invoice_status
--   set_opening_balance, ensure_books
--   report_profit_and_loss, report_balance_sheet, dashboard_summary, views opening_balances / ledger_gaps
-- Retires the shadow table invoice_payments. App roles lose direct write access to expenses / invoices / line items.

-- ===== 1. category names can no longer collide with built-in accounts (silent "Uncategorized" is gone) =====
create or replace function public._category_name_reserved(p_user uuid, p_name text)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select lower(btrim(p_name)) in ('accounts receivable', 'equipment', 'owner contributions', 'owner draws', 'opening balance equity',
                                  'income', 'interest expense', 'uncategorized expense')
      or lower(btrim(p_name)) like 'loan - %'
      or exists (select 1 from public.accounts a where a.user_id = p_user and lower(a.name) = lower(btrim(p_name)) and a.type <> 'expense')
$$;
revoke all on function public._category_name_reserved(uuid, text) from public, anon, authenticated;

create or replace function public._tg_category_name_check() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if public._category_name_reserved(new.user_id, new.name) then
    raise exception '"%" is a name Blue Collar Books uses internally. Please choose a different category name.', btrim(new.name) using errcode = '23514';
  end if;
  return new;
end $$;
revoke all on function public._tg_category_name_check() from public, anon, authenticated;
create trigger expense_categories_name_check before insert or update of name on public.expense_categories
  for each row execute function public._tg_category_name_check();

-- the expense account for a category: blank = the explicit "Uncategorized Expense"; a named category MUST have its own account
create or replace function public._expense_account(p_user uuid, p_category text)
returns uuid language plpgsql stable security definer set search_path = public, pg_temp as $$
declare ea uuid;
begin
  if btrim(coalesce(p_category, '')) = '' then
    select id into ea from public.accounts where user_id = p_user and system_key = 'uncategorized_expense';
    return ea;
  end if;
  select id into ea from public.accounts
   where user_id = p_user and type = 'expense' and system_key is null and lower(name) = lower(btrim(p_category)) limit 1;
  if ea is null then
    raise exception 'The category "%" has no matching expense account. Pick one of your categories.', btrim(p_category) using errcode = '23514';
  end if;
  return ea;
end $$;
revoke all on function public._expense_account(uuid, text) from public, anon, authenticated;

create or replace function public._expense_memo(p_vendor text, p_notes text, p_owner_paid boolean)
returns text language sql immutable set search_path = public, pg_temp as $$
  select p_vendor || case when coalesce(btrim(p_notes), '') <> '' then ' - ' || btrim(p_notes) else '' end
         || case when p_owner_paid then ' (paid personally by owner)' else '' end $$;
revoke all on function public._expense_memo(text, text, boolean) from public, anon, authenticated;

create or replace function public._post_expense(p_user uuid, p_expense_id text, p_paid_from uuid)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare x public.expenses; pf public.accounts; ea uuid; ok boolean;
begin
  select * into x from public.expenses where id = p_expense_id and user_id = p_user;
  if not found then raise exception 'expense not found' using errcode = 'P0002'; end if;
  if x.amount is null or x.amount <= 0 then raise exception 'expense amount must be greater than zero to post' using errcode = '23514'; end if;
  if x.date is null then raise exception 'expense needs a date to post' using errcode = '23514'; end if;

  select * into pf from public.accounts where id = p_paid_from and user_id = p_user;
  ok := found and pf.is_active and (
          (pf.type in ('asset','liability') and pf.system_key is null and pf.bank_account_id is not null)
          or coalesce(pf.system_key, '') = 'owner_contributions');
  if not coalesce(ok, false) then
    raise exception 'choose the bank or credit-card account the expense was paid from, or mark it as paid personally by the owner' using errcode = '23514';
  end if;

  ea := public._expense_account(p_user, x.category);
  return public._post_entry(p_user, x.date, public._expense_memo(x.vendor, x.notes, pf.system_key = 'owner_contributions'), 'expense', x.id, jsonb_build_array(
    jsonb_build_object('account_id', ea, 'debit', x.amount),
    jsonb_build_object('account_id', p_paid_from, 'credit', x.amount)));
end $$;

-- ===== 2. expenses: one atomic save, one atomic delete; the table is read-only to app roles =====
-- Consistency (deferred, judges the CURRENT row): a POSTED expense must still match its entry; a removed expense must have no live entry.
create or replace function public._check_expense(p_user uuid, p_id text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare x public.expenses; act uuid; ea uuid; cm jsonb; ok boolean;
begin
  select * into x from public.expenses where id = p_id and user_id = p_user;
  act := public._active_entry(p_user, 'expense', p_id);
  if not found then
    if act is not null then raise exception 'expense % was removed without reversing its ledger entry', p_id using errcode = '23514'; end if;
    return;
  end if;
  if act is null then return; end if;                      -- not (yet) posted: reported by the ledger_gaps view
  ea := public._expense_account(p_user, x.category);
  select jsonb_object_agg(account_id::text, s) into cm
    from (select account_id, sum(credit_cents) s from public.journal_lines where entry_id = act and credit_cents > 0 group by 1) q;
  select public._entry_matches(act, x.date, jsonb_build_object(ea::text, x.amount), coalesce(cm, '{}'::jsonb))
         and (select count(*) = 1 and sum(credit_cents) = x.amount from public.journal_lines where entry_id = act and credit_cents > 0)
    into ok;
  if not coalesce(ok, false) then
    raise exception 'expense % no longer matches its ledger entry; save it again through the app', p_id using errcode = '23514';
  end if;
end $$;
revoke all on function public._check_expense(uuid, text) from public, anon, authenticated;

create or replace function public._tg_expense_check() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then perform public._check_expense(new.user_id, new.id); end if;
  if tg_op in ('UPDATE', 'DELETE') and (tg_op = 'DELETE' or old.id is distinct from new.id) then
    perform public._check_expense(old.user_id, old.id);
  end if;
  return null;
end $$;
revoke all on function public._tg_expense_check() from public, anon, authenticated;
create constraint trigger expenses_ledger_check after insert or update or delete on public.expenses
  deferrable initially deferred for each row execute function public._tg_expense_check();

create or replace function public._tg_entry_text_source_check() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.source_type = 'expense' then perform public._check_expense(new.user_id, new.source_id); end if;
  return null;
end $$;
revoke all on function public._tg_entry_text_source_check() from public, anon, authenticated;
create constraint trigger journal_entries_text_source_check after insert on public.journal_entries
  deferrable initially deferred for each row when (new.source_type = 'expense') execute function public._tg_entry_text_source_check();

create or replace function public.save_expense(p_expense jsonb, p_paid_from_account_id uuid default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := auth.uid(); eid text := p_expense->>'id'; n int; x public.expenses; act uuid; pf uuid := p_paid_from_account_id;
        ea uuid; owner_paid boolean; cm jsonb;
begin
  if u is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if eid is null or btrim(eid) = '' then raise exception 'expense id is required' using errcode = '23514'; end if;
  if (p_expense->>'amount') is null or (p_expense->>'amount')::int <= 0 then raise exception 'expense amount must be greater than zero' using errcode = '23514'; end if;
  if nullif(p_expense->>'date', '') is null then raise exception 'expense needs a date' using errcode = '23514'; end if;
  perform public.seed_chart_of_accounts(u);
  perform pg_advisory_xact_lock(hashtextextended(u::text || '|expense|' || eid, 1));

  insert into public.expenses (id, user_id, date, vendor, category, amount, notes)
  values (eid, u, (p_expense->>'date')::date, coalesce(p_expense->>'vendor', ''), nullif(btrim(coalesce(p_expense->>'category', '')), ''),
          (p_expense->>'amount')::int, p_expense->>'notes')
  on conflict (id) do update set date = excluded.date, vendor = excluded.vendor, category = excluded.category,
    amount = excluded.amount, notes = excluded.notes
  where public.expenses.user_id = u;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'expense not found' using errcode = 'P0002'; end if;

  select * into x from public.expenses where id = eid and user_id = u;
  act := public._active_entry(u, 'expense', eid);
  if act is not null then
    if pf is null then select account_id into pf from public.journal_lines where entry_id = act and credit_cents > 0 limit 1; end if;
    ea := public._expense_account(u, x.category);
    select coalesce(sys.system_key, '') = 'owner_contributions' into owner_paid from public.accounts sys where sys.id = pf;
    select jsonb_object_agg(pf::text, x.amount) into cm;
    if public._entry_matches(act, x.date, jsonb_build_object(ea::text, x.amount), cm)
       and (select memo from public.journal_entries where id = act) = public._expense_memo(x.vendor, x.notes, coalesce(owner_paid, false)) then
      return;                                                -- nothing that matters to the books changed
    end if;
    perform public._reverse_entry(u, act, 'Edited expense');
  end if;
  if pf is null then raise exception 'choose the account this expense was paid from' using errcode = '23514'; end if;
  perform public._post_expense(u, eid, pf);
end $$;

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
  update public.plaid_transactions set category = null, updated_at = now() where user_id = u and expense_id = p_expense_id;
  delete from public.expenses where id = p_expense_id and user_id = u;     -- receipts cascade; the bank transaction returns to the review queue
end $$;

-- ===== 3. a bank transaction becomes an expense paid from ITS OWN connected account =====
create or replace function public.categorize_plaid_transaction(p_transaction_id text, p_category text)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := auth.uid(); t public.plaid_transactions; acct uuid; eid text;
begin
  if u is null then raise exception 'not signed in' using errcode = '28000'; end if;
  perform public.seed_chart_of_accounts(u);
  select * into t from public.plaid_transactions where id = p_transaction_id and user_id = u for update;
  if not found then raise exception 'transaction not found' using errcode = 'P0002'; end if;
  if t.expense_id is not null then raise exception 'this transaction is already an expense' using errcode = '23505'; end if;
  if t.excluded then raise exception 'restore this transaction before turning it into an expense' using errcode = '23514'; end if;
  if t.amount <= 0 then raise exception 'only money-out transactions can become expenses' using errcode = '23514'; end if;
  select a.id into acct from public.bank_accounts b join public.accounts a on a.bank_account_id = b.id and a.user_id = u
   where b.user_id = u and b.plaid_account_id = t.plaid_account_id;
  if acct is null then raise exception 'this transaction''s bank account is not set up in your books' using errcode = '23514'; end if;
  eid := gen_random_uuid()::text;
  perform public.save_expense(jsonb_build_object('id', eid, 'date', t.date, 'vendor', coalesce(t.merchant_name, t.name),
    'category', p_category, 'amount', t.amount, 'notes', 'Imported from bank transaction.'), acct);
  update public.plaid_transactions set category = p_category, expense_id = eid, updated_at = now() where id = t.id;
  return eid;
end $$;

-- ===== 4. invoices: saving also posts, in the same transaction =====
create or replace function public.save_invoice(p_invoice jsonb, p_lines jsonb default '[]'::jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := auth.uid(); inv_id text := p_invoice->>'id'; n int; want int; keep text[];
begin
  if u is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if inv_id is null or btrim(inv_id) = '' then raise exception 'invoice id is required' using errcode = '23514'; end if;
  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array' then raise exception 'lines must be an array' using errcode = '22023'; end if;

  insert into public.invoices (id, user_id, invoice_number, customer, customer_id, amount, status, invoice_date, terms, due_date,
                               po_number, bol_number, shipper, consignee, freight_description, updated_at)
  values (inv_id, u, p_invoice->>'invoice_number', p_invoice->>'customer', nullif(p_invoice->>'customer_id', ''),
          (p_invoice->>'amount')::int, p_invoice->>'status', nullif(p_invoice->>'invoice_date', '')::date, p_invoice->>'terms',
          nullif(p_invoice->>'due_date', '')::date, p_invoice->>'po_number', p_invoice->>'bol_number', p_invoice->>'shipper',
          p_invoice->>'consignee', p_invoice->>'freight_description', now())
  on conflict (id) do update set
    invoice_number = excluded.invoice_number, customer = excluded.customer, customer_id = excluded.customer_id,
    amount = excluded.amount, status = excluded.status, invoice_date = excluded.invoice_date, terms = excluded.terms,
    due_date = excluded.due_date, po_number = excluded.po_number, bol_number = excluded.bol_number, shipper = excluded.shipper,
    consignee = excluded.consignee, freight_description = excluded.freight_description, updated_at = now()
  where public.invoices.user_id = u;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'invoice not found' using errcode = 'P0002'; end if;

  want := jsonb_array_length(coalesce(p_lines, '[]'::jsonb));
  keep := array(select x->>'id' from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) x);
  delete from public.invoice_line_items where invoice_id = inv_id and user_id = u and not (id = any(keep));

  insert into public.invoice_line_items (id, invoice_id, user_id, description, amount, position, service_date, quantity, rate_cents)
  select x->>'id', inv_id, u, x->>'description', (x->>'amount')::int, (ord - 1)::int,
         nullif(x->>'service_date', '')::date, coalesce((x->>'quantity')::numeric, 1), (x->>'rate_cents')::bigint
  from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) with ordinality as t(x, ord)
  on conflict (id) do update set
    description = excluded.description, amount = excluded.amount, position = excluded.position,
    service_date = excluded.service_date, quantity = excluded.quantity, rate_cents = excluded.rate_cents
  where public.invoice_line_items.invoice_id = inv_id and public.invoice_line_items.user_id = u;

  select count(*) into n from public.invoice_line_items where invoice_id = inv_id and user_id = u;
  if n <> want then raise exception 'a line item id belongs to a different invoice' using errcode = '23505'; end if;

  perform public.sync_invoice_posting(inv_id);               -- same transaction: the invoice and its books entry stand or fall together
end $$;

create or replace function public.set_invoice_status(p_invoice_id text, p_status text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if p_status not in ('Draft', 'Sent') then
    raise exception 'an invoice becomes Paid by recording a payment, and Overdue/Due Today are worked out from its due date' using errcode = '23514';
  end if;
  update public.invoices set status = p_status, updated_at = now() where id = p_invoice_id and user_id = u;
  if not found then raise exception 'invoice not found' using errcode = 'P0002'; end if;
  perform public.sync_invoice_posting(p_invoice_id);
end $$;

create or replace function public.delete_invoice(p_invoice_id text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := auth.uid(); act uuid; num text;
begin
  if u is null then raise exception 'not signed in' using errcode = '28000'; end if;
  perform pg_advisory_xact_lock(hashtextextended(u::text || '|invoice|' || p_invoice_id, 1));
  select invoice_number into num from public.invoices where id = p_invoice_id and user_id = u for update;
  if not found then raise exception 'invoice not found' using errcode = 'P0002'; end if;
  if exists (select 1 from public.payment_applications where invoice_id = p_invoice_id) then
    raise exception 'Payments have been applied to invoice #%. Remove or change those payments first.', num using errcode = '23514';
  end if;
  act := public._active_entry(u, 'invoice', p_invoice_id);
  if act is not null then perform public._reverse_entry(u, act, 'Invoice #' || num || ' deleted'); end if;
  delete from public.invoices where id = p_invoice_id and user_id = u;     -- line items and attachments cascade
end $$;

drop table public.invoice_payments;                          -- shadow table retired: payments + payment_applications are the record

-- ===== 5. starting balances and chart setup =====
create or replace function public.ensure_books()
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null then raise exception 'not signed in' using errcode = '28000'; end if;
  perform public.seed_chart_of_accounts(auth.uid());
end $$;

create or replace function public.set_opening_balance(p_account_id uuid, p_amount_cents bigint, p_as_of date)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := auth.uid(); a public.accounts; act uuid;
begin
  if u is null then raise exception 'not signed in' using errcode = '28000'; end if;
  perform public.seed_chart_of_accounts(u);
  select * into a from public.accounts where id = p_account_id and user_id = u;
  if not found then raise exception 'account not found' using errcode = 'P0002'; end if;
  if a.system_key is not null or a.bank_account_id is null or a.type not in ('asset', 'liability') then
    raise exception 'starting balances apply to your bank and credit-card accounts' using errcode = '23514';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(u::text || '|opening_balance|' || a.id::text, 1));
  act := public._active_entry(u, 'opening_balance', a.id::text);
  if act is not null then perform public._reverse_entry(u, act, 'Starting balance changed'); end if;
  if coalesce(p_amount_cents, 0) = 0 then return; end if;
  perform public.post_opening_balance(a.id, p_amount_cents, p_as_of);
end $$;

-- the starting balance as the user typed it (credit cards: amount owed, positive)
create view public.opening_balances with (security_invoker = true) as
  select a.id as account_id, a.user_id, e.entry_date as as_of,
         case when a.type = 'asset' then l.debit_cents - l.credit_cents else l.credit_cents - l.debit_cents end as amount_cents
  from public.accounts a
  join public.journal_entry_trace e on e.source_type = 'opening_balance' and e.source_id = a.id::text and e.status = 'active'
  join public.journal_lines l on l.entry_id = e.id and l.account_id = a.id;
grant select on public.opening_balances to authenticated;

-- anything that SHOULD be in the books but is not (expected to be empty)
create view public.ledger_gaps with (security_invoker = true) as
  select 'expense'::text as source_type, x.id as source_id, x.user_id
    from public.expenses x
   where not exists (select 1 from public.journal_entry_trace t where t.source_type = 'expense' and t.source_id = x.id and t.status = 'active')
  union all
  select 'invoice', i.id, i.user_id
    from public.invoices i
   where i.status <> 'Draft'
     and not exists (select 1 from public.journal_entry_trace t where t.source_type = 'invoice' and t.source_id = i.id and t.status = 'active');
grant select on public.ledger_gaps to authenticated;

-- ===== 6. reports =====
create or replace function public.report_profit_and_loss(p_from date, p_to date, p_basis text default 'cash')
returns table (section text, account_id uuid, name text, amount_cents bigint)
language plpgsql stable set search_path = public, pg_temp as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if p_basis not in ('cash', 'accrual') then raise exception 'basis must be cash or accrual' using errcode = '22023'; end if;
  return query
    select 'expense'::text, a.id, a.name, sum(l.debit_cents - l.credit_cents)::bigint
      from public.accounts a join public.journal_lines l on l.account_id = a.id join public.journal_entries e on e.id = l.entry_id
     where a.user_id = u and a.type = 'expense' and e.entry_date between p_from and p_to
     group by a.id, a.name having sum(l.debit_cents - l.credit_cents) <> 0
    union all
    select 'income'::text, a.id, a.name, sum(l.credit_cents - l.debit_cents)::bigint
      from public.accounts a join public.journal_lines l on l.account_id = a.id join public.journal_entries e on e.id = l.entry_id
     where p_basis = 'accrual' and a.user_id = u and a.type = 'income' and e.entry_date between p_from and p_to
     group by a.id, a.name having sum(l.credit_cents - l.debit_cents) <> 0
    union all
    select 'income'::text, a.id, a.name, sum(pa.amount_cents)::bigint
      from public.payment_applications pa join public.payments p on p.id = pa.payment_id
      join public.accounts a on a.user_id = p.user_id and a.system_key = 'income'
     where p_basis = 'cash' and p.user_id = u and p.voided_at is null and p.payment_date between p_from and p_to
     group by a.id, a.name
    union all
    select 'unapplied'::text, null::uuid, 'Payments received but not yet matched to an invoice'::text, sum(pb.unapplied_cents)::bigint
      from public.payment_balances pb
     where p_basis = 'cash' and pb.user_id = u and pb.payment_date between p_from and p_to and pb.unapplied_cents > 0
     having sum(pb.unapplied_cents) > 0;
end $$;

create or replace function public.report_balance_sheet(p_as_of date)
returns table (section text, account_id uuid, name text, amount_cents bigint)
language plpgsql stable set search_path = public, pg_temp as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'not signed in' using errcode = '28000'; end if;
  return query
    select (case a.type when 'asset' then 'assets' when 'liability' then 'liabilities' else 'equity' end)::text, a.id, a.name,
           (case when a.type = 'asset' then sum(l.debit_cents - l.credit_cents) else sum(l.credit_cents - l.debit_cents) end)::bigint
      from public.accounts a join public.journal_lines l on l.account_id = a.id join public.journal_entries e on e.id = l.entry_id
     where a.user_id = u and a.type in ('asset', 'liability', 'equity') and e.entry_date <= p_as_of
     group by a.id, a.name, a.type
    having sum(l.debit_cents - l.credit_cents) <> 0
    union all
    select 'equity'::text, null::uuid, 'Profit to date'::text, sum(l.credit_cents - l.debit_cents)::bigint
      from public.accounts a join public.journal_lines l on l.account_id = a.id join public.journal_entries e on e.id = l.entry_id
     where a.user_id = u and a.type in ('income', 'expense') and e.entry_date <= p_as_of
    having sum(l.credit_cents - l.debit_cents) <> 0;
end $$;

create or replace function public.dashboard_summary(p_today date, p_month_start date, p_month_end date)
returns table (cash_available_cents bigint, money_in_cents bigint, money_out_cents bigint, profit_cents bigint,
               waiting_to_be_paid_cents bigint, overdue_cents bigint, accounts_without_starting_balance int, has_bank_accounts boolean)
language plpgsql stable set search_path = public, pg_temp as $$
declare u uuid := auth.uid(); cash bigint; mi bigint; mo bigint; wait bigint; od bigint; missing int; banks int;
begin
  if u is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select coalesce(sum(l.debit_cents - l.credit_cents), 0) into cash
    from public.accounts a join public.journal_lines l on l.account_id = a.id join public.journal_entries e on e.id = l.entry_id
   where a.user_id = u and a.type = 'asset' and a.system_key is null and a.bank_account_id is not null and e.entry_date <= p_today;
  select coalesce(sum(pa.amount_cents), 0) into mi
    from public.payment_applications pa join public.payments p on p.id = pa.payment_id
   where p.user_id = u and p.voided_at is null and p.payment_date between p_month_start and p_month_end;
  select coalesce(sum(l.debit_cents - l.credit_cents), 0) into mo
    from public.accounts a join public.journal_lines l on l.account_id = a.id join public.journal_entries e on e.id = l.entry_id
   where a.user_id = u and a.type = 'expense' and e.entry_date between p_month_start and p_month_end;
  select coalesce(sum(b.balance_cents), 0), coalesce(sum(b.balance_cents) filter (where b.derived_status = 'Overdue'), 0) into wait, od
    from public.invoice_balances_as_of(p_today) b where b.user_id = u;
  select count(*) filter (where not exists (select 1 from public.journal_entry_trace t where t.source_type = 'opening_balance'
                                            and t.source_id = a.id::text and t.status = 'active')), count(*)
    into missing, banks
    from public.accounts a where a.user_id = u and a.system_key is null and a.bank_account_id is not null and a.is_active;
  return query select cash, mi, mo, mi - mo, wait, od, missing, banks > 0;
end $$;

-- ===== 7. privileges: the app reads these tables; writes go through the functions above =====
revoke insert, update, delete on public.expenses, public.invoices, public.invoice_line_items from authenticated, anon;
do $$
declare r record; f text;
begin
  for r in select c.relname from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm') loop
    execute format('revoke truncate, references, trigger on public.%I from anon, authenticated', r.relname);
  end loop;
  foreach f in array array['ensure_books()', 'save_expense(jsonb,uuid)', 'delete_expense(text)', 'categorize_plaid_transaction(text,text)',
    'save_invoice(jsonb,jsonb)', 'set_invoice_status(text,text)', 'delete_invoice(text)', 'set_opening_balance(uuid,bigint,date)',
    'report_profit_and_loss(date,date,text)', 'report_balance_sheet(date)', 'dashboard_summary(date,date,date)']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- ===== 8. Follow-up migration "stage_e1b_expense_entry_strict_check" =====
-- An expense row may exist un-posted (reported by ledger_gaps), but an expense's ENTRY can never be reversed/removed behind its back:
-- whenever an entry is written for an expense, the expense row (if it still exists) must have an active entry at commit.
drop function public._check_expense(uuid, text);
create or replace function public._check_expense(p_user uuid, p_id text, p_strict boolean default false)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare x public.expenses; act uuid; ea uuid; cm jsonb; ok boolean;
begin
  select * into x from public.expenses where id = p_id and user_id = p_user;
  act := public._active_entry(p_user, 'expense', p_id);
  if not found then
    if act is not null then raise exception 'expense % was removed without reversing its ledger entry', p_id using errcode = '23514'; end if;
    return;
  end if;
  if act is null then
    if p_strict then raise exception 'the books entry for expense % cannot be reversed on its own; edit or delete the expense instead', p_id using errcode = '23514'; end if;
    return;
  end if;
  ea := public._expense_account(p_user, x.category);
  select jsonb_object_agg(account_id::text, s) into cm
    from (select account_id, sum(credit_cents) s from public.journal_lines where entry_id = act and credit_cents > 0 group by 1) q;
  select public._entry_matches(act, x.date, jsonb_build_object(ea::text, x.amount), coalesce(cm, '{}'::jsonb))
         and (select count(*) = 1 and sum(credit_cents) = x.amount from public.journal_lines where entry_id = act and credit_cents > 0)
    into ok;
  if not coalesce(ok, false) then
    raise exception 'expense % no longer matches its ledger entry; save it again through the app', p_id using errcode = '23514';
  end if;
end $$;
revoke all on function public._check_expense(uuid, text, boolean) from public, anon, authenticated;

create or replace function public._tg_entry_text_source_check() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.source_type = 'expense' then perform public._check_expense(new.user_id, new.source_id, true); end if;
  return null;
end $$;
