-- Stage D2 tests: owner draws / contributions (inv 16), expenses paid personally by the owner,
-- tightened expense "Paid from" rule, DB-enforced consistency, ownership. One DO block, always rolls back.
-- Success = message starts 'ROLLED BACK - ALL PASS'.
do $test$
declare
  a uuid := '00000000-0000-4000-8000-0000000000aa';
  b uuid := '00000000-0000-4000-8000-0000000000bb';
  c uuid := '00000000-0000-4000-8000-0000000000cc';
  chk uuid; card uuid; b_chk uuid; c_chk uuid; ar uuid; eqp uuid; loansp uuid; draws uuid; contribs uuid; fuel uuid;
  d1 uuid; k1 uuid; d2 uuid; e uuid; n int; v bigint; v2 bigint; t record;
  results text[] := '{}'; failures text[] := '{}';
begin
  -- Stage F5: signed-in users can no longer call these low-level posting functions. The tests still exercise them through
  -- temporary SECURITY DEFINER wrappers (they run as the schema owner but still see the signed-in user via auth.uid()).
  execute 'create function pg_temp.post_expense(p_expense_id text, p_paid_from_account_id uuid) returns uuid language sql security definer as $f$ select public.post_expense(p_expense_id, p_paid_from_account_id) $f$';
  execute 'create function pg_temp.repost_expense(p_expense_id text, p_paid_from_account_id uuid default null) returns uuid language sql security definer as $f$ select case when p_paid_from_account_id is null then public.repost_expense(p_expense_id) else public.repost_expense(p_expense_id, p_paid_from_account_id) end $f$';
  execute 'create function pg_temp.post_opening_balance(p_account_id uuid, p_amount_cents bigint, p_as_of date) returns uuid language sql security definer as $f$ select public.post_opening_balance(p_account_id, p_amount_cents, p_as_of) $f$';
  execute 'create function pg_temp.reverse_journal_entry(p_entry_id uuid, p_memo text default null) returns uuid language sql security definer as $f$ select case when p_memo is null then public.reverse_journal_entry(p_entry_id) else public.reverse_journal_entry(p_entry_id, p_memo) end $f$';
  execute 'create function pg_temp.reverse_active_entry(p_source_type text, p_source_id text, p_memo text default null) returns uuid language sql security definer as $f$ select case when p_memo is null then public.reverse_active_entry(p_source_type, p_source_id) else public.reverse_active_entry(p_source_type, p_source_id, p_memo) end $f$';
  execute 'create function pg_temp.sync_invoice_posting(p_invoice_id text) returns uuid language sql security definer as $f$ select public.sync_invoice_posting(p_invoice_id) $f$';
  execute 'create function pg_temp.ensure_chart_of_accounts() returns void language sql security definer as $f$ select public.ensure_chart_of_accounts() $f$';
  insert into auth.users (id,email,aud,role) values
    (a,'ta@example.invalid','authenticated','authenticated'),(b,'tb@example.invalid','authenticated','authenticated'),(c,'tc@example.invalid','authenticated','authenticated');
  insert into bank_accounts (id,user_id,name,last4,balance,last_updated,subtype) values
    ('bk1',a,'Checking','1111',0,'x',null),('bk3',a,'Visa','3333',0,'x','credit card'),('bkb',b,'B Checking','9999',0,'x',null),('bkc',c,'C Checking','8888',0,'x',null);
  insert into expense_categories (user_id,name) values (a,'Fuel');
  insert into expenses (id,user_id,vendor,category,amount,date,notes) values
    ('exp1',a,'Loves','Fuel',12000,'2026-06-09','Diesel'),('exp2',a,'Shop','Fuel',3000,'2026-06-10',null);
  perform seed_chart_of_accounts(a); perform seed_chart_of_accounts(b); perform seed_chart_of_accounts(c);
  select id into chk from accounts where bank_account_id='bk1'; select id into card from accounts where bank_account_id='bk3';
  select id into b_chk from accounts where bank_account_id='bkb'; select id into c_chk from accounts where bank_account_id='bkc';
  select id into ar from accounts where user_id=a and system_key='accounts_receivable';
  select id into eqp from accounts where user_id=a and system_key='equipment';
  loansp := _new_loan_account(a, 'Test Loan');  -- a real loan liability account (no generic Loans Payable exists)
  select id into draws from accounts where user_id=a and system_key='owner_draws';
  select id into contribs from accounts where user_id=a and system_key='owner_contributions';
  select id into fuel from accounts where user_id=a and name='Fuel';
  execute 'create function pg_temp.bal(p uuid) returns bigint language sql as $f$ select balance_cents from account_balances where account_id = p $f$';

  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform pg_temp.post_opening_balance(chk, 100000, '2026-06-01');

  -- ---- owner draw: Dr Owner Draws / Cr bank; not an expense (inv 16) ----
  d1 := record_owner_draw('2026-06-10', 20000, chk, 'personal');
  -- (equity accounts carry credit-normal balances, so Owner Draws shows as a negative equity balance)
  if pg_temp.bal(chk) = 80000 and pg_temp.bal(draws) = -20000
     and (select source_type || ':' || source_id from journal_entries where source_id = d1::text and reverses_entry_id is null) = 'owner_draw:' || d1::text
  then results := results || 'PASS owner draw: Dr Owner Draws / Cr bank; traceable'::text;
  else failures := failures || ('FAIL draw posting ' || pg_temp.bal(chk) || '/' || pg_temp.bal(draws)); end if;
  begin set constraints all immediate; results := results || 'PASS commit-time ledger checks run correctly as the signed-in role'::text;
  exception when others then failures := failures || ('FAIL commit-time checks as authenticated: ' || sqlstate || ' ' || sqlerrm); end;
  set constraints all deferred;
  select coalesce(sum(balance_cents),0) into v from account_balances where user_id = a and type in ('income','expense');
  if v = 0 then results := results || 'PASS inv 16: a draw has zero P&L effect'::text; else failures := failures || ('FAIL draw hit P&L ' || v); end if;

  -- ---- owner contribution: Dr bank / Cr Owner Contributions; not income ----
  k1 := record_owner_contribution('2026-06-11', 50000, chk, 'cash in');
  if pg_temp.bal(chk) = 130000 and pg_temp.bal(contribs) = 50000
     and (select source_type from journal_entries where source_id = k1::text and reverses_entry_id is null) = 'owner_contribution'
  then results := results || 'PASS owner contribution: Dr bank / Cr Owner Contributions; traceable'::text;
  else failures := failures || ('FAIL contribution posting ' || pg_temp.bal(chk) || '/' || pg_temp.bal(contribs)); end if;
  select coalesce(sum(balance_cents),0) into v from account_balances where user_id = a and type in ('income','expense');
  if v = 0 then results := results || 'PASS inv 16: a contribution is not income'::text; else failures := failures || ('FAIL contribution hit P&L ' || v); end if;

  -- ---- rejected requests ----
  for t in select * from (values
    ('draw from a credit card',        '23514', format('select record_owner_draw(''2026-06-12'',100,%L)', card)),
    ('draw from the A/R account',      '23514', format('select record_owner_draw(''2026-06-12'',100,%L)', ar)),
    ('contribution into Equipment',    '23514', format('select record_owner_contribution(''2026-06-12'',100,%L)', eqp)),
    ('draw from an expense account',   '23514', format('select record_owner_draw(''2026-06-12'',100,%L)', fuel)),
    ('draw from the Owner Draws account itself','23514', format('select record_owner_draw(''2026-06-12'',100,%L)', draws)),
    ('zero draw',                      '23514', format('select record_owner_draw(''2026-06-12'',0,%L)', chk)),
    ('draw without a date',            '23514', format('select record_owner_draw(null,100,%L)', chk)),
    ('draw from another user''s account','23514', format('select record_owner_draw(''2026-06-12'',100,%L)', b_chk))
  ) as v(label, code, s)
  loop
    select count(*) into n from owner_transactions;
    begin execute t.s; failures := failures || ('FAIL accepted: ' || t.label);
    exception when others then
      if sqlstate = t.code and (select count(*) from owner_transactions) = n then results := results || ('PASS rejected: ' || t.label);
      else failures := failures || ('FAIL ' || t.label || ' -> ' || sqlstate || ' ' || sqlerrm); end if;
    end;
  end loop;

  -- ---- edit = reversal + repost; void ----
  perform update_owner_transaction(d1, '2026-06-12', 15000, chk, 'edited');
  if pg_temp.bal(chk) = 135000 and pg_temp.bal(draws) = -15000
     and (select count(*) from journal_entry_trace where source_id = d1::text) = 3
     and (select count(*) from journal_entry_trace where source_id = d1::text and status = 'active') = 1
  then results := results || 'PASS edited draw: old entry reversed, replacement posted'::text;
  else failures := failures || ('FAIL update ' || pg_temp.bal(chk) || '/' || pg_temp.bal(draws)); end if;
  d2 := record_owner_draw('2026-06-13', 1000, chk);
  perform void_owner_transaction(d2);
  if pg_temp.bal(chk) = 135000 and pg_temp.bal(draws) = -15000 and (select voided_at is not null from owner_transactions where id = d2)
     and not exists (select 1 from journal_entry_trace where source_id = d2::text and status = 'active')
  then results := results || 'PASS void: entry reversed, row kept for history'::text; else failures := failures || ('FAIL void ' || pg_temp.bal(chk) || '/' || pg_temp.bal(draws)); end if;
  perform void_owner_transaction(d2);
  results := results || 'PASS voiding twice is a no-op'::text;
  begin perform update_owner_transaction(d2, '2026-06-14', 100, chk); failures := failures || 'FAIL edited a voided owner transaction';
  exception when others then if sqlstate = '23514' then results := results || 'PASS a voided owner transaction cannot be edited'::text; else failures := failures || ('FAIL voided edit ' || sqlstate); end if; end;

  -- ---- expense paid personally by the owner: Dr expense / Cr Owner Contributions; bank untouched ----
  perform pg_temp.post_expense('exp1', contribs);
  if pg_temp.bal(fuel) = 12000 and pg_temp.bal(contribs) = 62000 and pg_temp.bal(chk) = 135000
     and exists (select 1 from journal_entries where source_id = 'exp1' and memo like '%paid personally by owner%')
  then results := results || 'PASS owner-paid expense: Dr expense / Cr Owner Contributions; no bank account pretended'::text;
  else failures := failures || ('FAIL owner-paid expense ' || pg_temp.bal(fuel) || '/' || pg_temp.bal(contribs) || '/' || pg_temp.bal(chk)); end if;
  -- app roles can no longer write expenses directly (save_expense does), so the raw edit runs as the privileged role
  reset role;
  update expenses set amount = 14000 where id = 'exp1';
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform pg_temp.repost_expense('exp1');
  if pg_temp.bal(fuel) = 14000 and pg_temp.bal(contribs) = 64000 and pg_temp.bal(chk) = 135000
  then results := results || 'PASS editing an owner-paid expense keeps it owner-paid (reversal + repost)'::text; else failures := failures || ('FAIL owner-paid repost ' || pg_temp.bal(contribs)); end if;
  perform pg_temp.repost_expense('exp1', chk);
  if pg_temp.bal(contribs) = 50000 and pg_temp.bal(chk) = 121000 and pg_temp.bal(fuel) = 14000
  then results := results || 'PASS an owner-paid expense can later be re-pointed at a real bank account'::text; else failures := failures || ('FAIL repoint ' || pg_temp.bal(contribs) || '/' || pg_temp.bal(chk)); end if;
  select coalesce(sum(balance_cents),0) into v from account_balances where user_id = a and type = 'income';
  if v = 0 then results := results || 'PASS owner-paid expense creates no income'::text; else failures := failures || 'FAIL income appeared'; end if;

  -- ---- expense "Paid from" must be a real source (tightened rule) ----
  for t in select * from (values
    ('expense paid from Accounts Receivable', '23514', format('select pg_temp.post_expense(''exp2'', %L)', ar)),
    ('expense paid from Equipment',           '23514', format('select pg_temp.post_expense(''exp2'', %L)', eqp)),
    ('expense paid from a loan account',      '23514', format('select pg_temp.post_expense(''exp2'', %L)', loansp)),
    ('expense paid from Owner Draws',         '23514', format('select pg_temp.post_expense(''exp2'', %L)', draws)),
    ('expense paid from an expense account',  '23514', format('select pg_temp.post_expense(''exp2'', %L)', fuel)),
    ('expense with no account chosen',        '23514', 'select pg_temp.post_expense(''exp2'', null)')
  ) as v(label, code, s)
  loop
    begin execute t.s; failures := failures || ('FAIL accepted: ' || t.label);
    exception when others then
      if sqlstate = t.code then results := results || ('PASS rejected: ' || t.label);
      else failures := failures || ('FAIL ' || t.label || ' -> ' || sqlstate || ' ' || sqlerrm); end if;
    end;
  end loop;

  -- ---- an owner event's ledger entry cannot be reversed behind its back ----
  select id into e from journal_entry_trace where source_id = d1::text and status = 'active';
  begin
    perform pg_temp.reverse_journal_entry(e);
    set constraints all immediate;
    failures := failures || 'FAIL owner entry reversed behind the transaction''s back';
  exception when others then
    if sqlstate = '23514' then results := results || 'PASS DB: an owner transaction''s ledger entry cannot be reversed without voiding it'::text;
    else failures := failures || ('FAIL direct reverse ' || sqlstate || ' ' || sqlerrm); end if;
  end;
  set constraints all deferred;

  -- ---- database-level consistency (privileged role) ----
  reset role;
  for t in select * from (values
    ('owner amount changed without reposting',   '23514', format('update owner_transactions set amount_cents = 15500 where id = %L', d1)),
    ('owner date changed without reposting',     '23514', format('update owner_transactions set txn_date = ''2026-07-01'' where id = %L', d1)),
    ('draw turned into a contribution without reposting', '23514', format('update owner_transactions set kind = ''contribution'' where id = %L', d1)),
    ('owner account changed without reposting',  '23514', format('update owner_transactions set account_id = %L where id = %L', card, d1)),
    ('owner transaction voided without reversing','23514', format('update owner_transactions set voided_at = now() where id = %L', d1)),
    ('owner transaction inserted without an entry','23514', format('insert into owner_transactions (user_id,kind,txn_date,amount_cents,account_id) values (%L,''draw'',''2026-06-01'',500,%L)', a, chk)),
    ('owner transaction on another user''s account','23503', format('insert into owner_transactions (user_id,kind,txn_date,amount_cents,account_id) values (%L,''draw'',''2026-06-01'',500,%L)', a, b_chk)),
    ('owner transaction with unknown kind',      '23514', format('insert into owner_transactions (user_id,kind,txn_date,amount_cents,account_id) values (%L,''gift'',''2026-06-01'',500,%L)', a, chk)),
    ('delete a live owner transaction',          '23503', format('delete from owner_transactions where id = %L', d1))
  ) as v(label, code, s)
  loop
    begin
      execute t.s; set constraints all immediate;
      failures := failures || ('FAIL accepted: ' || t.label);
    exception when others then
      if sqlstate = t.code then results := results || ('PASS DB rejects: ' || t.label);
      else failures := failures || ('FAIL ' || t.label || ' -> ' || sqlstate || ' ' || sqlerrm); end if;
    end;
    set constraints all deferred;
  end loop;

  select sum(debit_total), sum(credit_total) into v, v2 from account_balances where user_id = a;
  if v = v2 then results := results || 'PASS inv 8: debits = credits'::text; else failures := failures || 'FAIL inv 8'; end if;
  select
    coalesce(sum(balance_cents) filter (where type='asset'),0) - coalesce(sum(balance_cents) filter (where type='liability'),0),
    coalesce(sum(balance_cents) filter (where type='equity'),0) + coalesce(sum(balance_cents) filter (where type='income'),0) - coalesce(sum(balance_cents) filter (where type='expense'),0)
  into v, v2 from account_balances where user_id = a;
  if v = v2 then results := results || 'PASS inv 9/10: assets - liabilities = equity + (income - expenses)'::text; else failures := failures || ('FAIL inv 9 ' || v || '/' || v2); end if;

  -- ---- other users and roles ----
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  for t in select * from (values
    ('B updating A''s owner transaction', 'P0002', format('select update_owner_transaction(%L,''2026-06-01'',100,%L)', d1, b_chk)),
    ('B voiding A''s owner transaction',  'P0002', format('select void_owner_transaction(%L)', d1)),
    ('B drawing from A''s account',       '23514', format('select record_owner_draw(''2026-06-01'',100,%L)', chk)),
    ('authenticated INSERT owner_transactions', '42501', format('insert into owner_transactions (user_id,kind,txn_date,amount_cents,account_id) values (auth.uid(),''draw'',''2026-06-01'',1,%L)', b_chk)),
    ('authenticated UPDATE owner_transactions', '42501', 'update owner_transactions set amount_cents = 1'),
    ('authenticated DELETE owner_transactions', '42501', 'delete from owner_transactions')
  ) as v(label, code, s)
  loop
    begin execute t.s; failures := failures || ('FAIL accepted: ' || t.label);
    exception when others then
      if sqlstate = t.code then results := results || ('PASS rejected: ' || t.label);
      else failures := failures || ('FAIL ' || t.label || ' -> ' || sqlstate || ' ' || sqlerrm); end if;
    end;
  end loop;
  select count(*) into n from owner_transactions;
  if n = 0 then results := results || 'PASS B sees none of A''s owner transactions'::text; else failures := failures || 'FAIL B sees A rows'; end if;
  reset role;

  perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  set local role authenticated;
  begin perform record_owner_draw('2026-06-01',100,chk); failures := failures || 'FAIL unauth';
  exception when others then if sqlstate = '28000' then results := results || 'PASS not signed in is refused'::text; else failures := failures || ('FAIL unauth ' || sqlstate); end if; end;
  reset role;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  begin perform record_owner_draw('2026-06-01',100,chk); failures := failures || 'FAIL anon';
  exception when insufficient_privilege then results := results || 'PASS anon cannot execute record_owner_draw'::text; end;
  begin perform 1 from owner_transactions; failures := failures || 'FAIL anon read';
  exception when insufficient_privilege then results := results || 'PASS anon cannot read owner_transactions'::text; end;
  reset role;

  -- ---- deleting a user cascades ----
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform record_owner_contribution('2026-06-02', 1000, c_chk);
  reset role;
  begin
    set constraints all immediate; set constraints all deferred;
    delete from auth.users where id = c;
    select count(*) into n from owner_transactions where user_id = c; select n + count(*) into n from journal_entries where user_id = c;
    if n = 0 then results := results || 'PASS deleting a user removes their owner transactions and ledger'::text; else failures := failures || 'FAIL user delete left rows'; end if;
  exception when others then failures := failures || ('FAIL user delete: ' || sqlerrm); end;

  begin set constraints all immediate; results := results || 'PASS all deferred checks hold for the full scenario'::text;
  exception when others then failures := failures || ('FAIL deferred ' || sqlerrm); end;

  if array_length(failures,1) is null then
    raise exception 'ROLLED BACK - ALL PASS (% checks): %', array_length(results,1), array_to_string(results,' | ');
  else
    raise exception 'ROLLED BACK - % FAILURES: % || PASSED: %', array_length(failures,1), array_to_string(failures,' | '), array_to_string(results,' | ');
  end if;
end
$test$;
