-- Stage D3 tests: loans (inv 15), loan payments with principal/interest split, equipment purchases and financed
-- equipment (inv 17), DB-enforced consistency, ownership. One DO block, always rolls back.
-- Success = message starts 'ROLLED BACK - ALL PASS'.
do $test$
declare
  a uuid := '00000000-0000-4000-8000-0000000000aa';
  b uuid := '00000000-0000-4000-8000-0000000000bb';
  c uuid := '00000000-0000-4000-8000-0000000000cc';
  chk uuid; sav uuid; card uuid; b_chk uuid; c_chk uuid; ar uuid; eqp uuid; intx uuid; draws uuid;
  l1 uuid; l1a uuid; l2 uuid; l2a uuid; p1 uuid; p2 uuid; p3 uuid; p4 uuid; a1 uuid; a2 uuid; e uuid;
  n int; v bigint; v2 bigint; t record;
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
    ('bk1',a,'Checking','1111',0,'x',null),('bk2',a,'Savings','2222',0,'x',null),('bk3',a,'Visa','3333',0,'x','credit card'),
    ('bkb',b,'B Checking','9999',0,'x',null),('bkc',c,'C Checking','8888',0,'x',null);
  perform seed_chart_of_accounts(a); perform seed_chart_of_accounts(b); perform seed_chart_of_accounts(c);
  select id into chk from accounts where bank_account_id='bk1'; select id into sav from accounts where bank_account_id='bk2';
  select id into card from accounts where bank_account_id='bk3'; select id into b_chk from accounts where bank_account_id='bkb';
  select id into c_chk from accounts where bank_account_id='bkc';
  select id into ar from accounts where user_id=a and system_key='accounts_receivable';
  select id into eqp from accounts where user_id=a and system_key='equipment';
  select id into intx from accounts where user_id=a and system_key='interest_expense';
  select id into draws from accounts where user_id=a and system_key='owner_draws';
  execute 'create function pg_temp.bal(p uuid) returns bigint language sql as $f$ select balance_cents from account_balances where account_id = p $f$';
  execute 'create function pg_temp.pl(u uuid) returns bigint language sql as $f$ select coalesce(sum(case when type = ''income'' then balance_cents else -balance_cents end),0) from account_balances where user_id = u and type in (''income'',''expense'') $f$';

  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform pg_temp.post_opening_balance(chk, 100000, '2026-06-01');

  -- ---- loan received: Dr bank / Cr the loan's own liability account; not income (inv 15) ----
  l1 := record_loan('Truck loan', 'First Bank', 500000, '2026-06-01', chk, 650, 'note');
  select account_id into l1a from loans where id = l1;
  if pg_temp.bal(chk) = 600000 and pg_temp.bal(l1a) = 500000 and pg_temp.pl(a) = 0
     and exists (select 1 from accounts where id = l1a and name = 'Loan - Truck loan' and type = 'liability')
     and (select source_type || ':' || source_id from journal_entries where source_id = l1::text and reverses_entry_id is null) = 'loan:' || l1::text
  then results := results || 'PASS inv 15: loan received posts Dr bank / Cr loan liability; zero P&L effect; traceable'::text;
  else failures := failures || ('FAIL loan posting ' || pg_temp.bal(chk) || '/' || pg_temp.bal(l1a) || '/' || pg_temp.pl(a)); end if;
  begin set constraints all immediate; results := results || 'PASS commit-time ledger checks run correctly as the signed-in role'::text;
  exception when others then failures := failures || ('FAIL commit-time checks as authenticated: ' || sqlstate || ' ' || sqlerrm); end;
  set constraints all deferred;

  -- ---- loan payment: principal reduces the loan, interest is the only expense (inv 15) ----
  p1 := record_loan_payment(l1, '2026-07-01', 20000, 3000, chk, 'July');
  if pg_temp.bal(chk) = 577000 and pg_temp.bal(l1a) = 480000 and pg_temp.bal(intx) = 3000 and pg_temp.pl(a) = -3000
  then results := results || 'PASS inv 15: loan payment splits Dr loan (principal) + Dr Interest Expense / Cr bank; only interest hits P&L'::text;
  else failures := failures || ('FAIL loan payment ' || pg_temp.bal(chk) || '/' || pg_temp.bal(l1a) || '/' || pg_temp.bal(intx) || '/' || pg_temp.pl(a)); end if;
  p2 := record_loan_payment(l1, '2026-08-01', 0, 1500, chk);
  p3 := record_loan_payment(l1, '2026-08-02', 10000, 0, chk);
  if pg_temp.bal(l1a) = 470000 and pg_temp.bal(intx) = 4500 and pg_temp.bal(chk) = 565500
  then results := results || 'PASS interest-only and principal-only payments post correctly'::text;
  else failures := failures || ('FAIL partial payments ' || pg_temp.bal(l1a) || '/' || pg_temp.bal(intx) || '/' || pg_temp.bal(chk)); end if;

  -- ---- rejected requests ----
  for t in select * from (values
    ('loan: blank name',               '23514', format('select record_loan(''  '',null,1000,''2026-06-01'',%L)', chk)),
    ('loan: zero amount',              '23514', format('select record_loan(''X'',null,0,''2026-06-01'',%L)', chk)),
    ('loan: no date',                  '23514', format('select record_loan(''X'',null,1000,null,%L)', chk)),
    ('loan: deposited to a credit card','23514', format('select record_loan(''X'',null,1000,''2026-06-01'',%L)', card)),
    ('loan: deposited to A/R',         '23514', format('select record_loan(''X'',null,1000,''2026-06-01'',%L)', ar)),
    ('loan: deposited to another user''s account','23514', format('select record_loan(''X'',null,1000,''2026-06-01'',%L)', b_chk)),
    ('loan: duplicate name',           '23505', format('select record_loan(''Truck loan'',null,1000,''2026-06-01'',%L)', chk)),
    ('payment: zero principal and interest','23514', format('select record_loan_payment(%L,''2026-09-01'',0,0,%L)', l1, chk)),
    ('payment: negative principal',    '23514', format('select record_loan_payment(%L,''2026-09-01'',-5,100,%L)', l1, chk)),
    ('payment: null interest',         '23514', format('select record_loan_payment(%L,''2026-09-01'',100,null,%L)', l1, chk)),
    ('payment: more principal than the loan has left','23514', format('select record_loan_payment(%L,''2026-09-01'',470001,0,%L)', l1, chk)),
    ('payment: dated before the loan', '23514', format('select record_loan_payment(%L,''2026-05-01'',100,0,%L)', l1, chk)),
    ('payment: paid from a credit card','23514', format('select record_loan_payment(%L,''2026-09-01'',100,0,%L)', l1, card)),
    ('payment: paid from Equipment',   '23514', format('select record_loan_payment(%L,''2026-09-01'',100,0,%L)', l1, eqp)),
    ('payment: paid from another user''s account','23514', format('select record_loan_payment(%L,''2026-09-01'',100,0,%L)', l1, b_chk)),
    ('payment: unknown loan',          'P0002', format('select record_loan_payment(gen_random_uuid(),''2026-09-01'',100,0,%L)', chk)),
    ('equipment: zero cost',           '23514', format('select record_equipment(''X'',''2026-06-01'',0,%L::jsonb)', json_build_array(json_build_object('kind','account','account_id',chk,'amount_cents',100)))),
    ('equipment: blank name',          '23514', format('select record_equipment('' '',''2026-06-01'',100,%L::jsonb)', json_build_array(json_build_object('kind','account','account_id',chk,'amount_cents',100)))),
    ('equipment: no date',             '23514', format('select record_equipment(''X'',null,100,%L::jsonb)', json_build_array(json_build_object('kind','account','account_id',chk,'amount_cents',100)))),
    ('equipment: no funding',          '23514', 'select record_equipment(''X'',''2026-06-01'',100,''[]''::jsonb)'),
    ('equipment: funding does not add up','23514', format('select record_equipment(''X'',''2026-06-01'',100,%L::jsonb)', json_build_array(json_build_object('kind','account','account_id',chk,'amount_cents',90)))),
    ('equipment: paid from A/R',       '23514', format('select record_equipment(''X'',''2026-06-01'',100,%L::jsonb)', json_build_array(json_build_object('kind','account','account_id',ar,'amount_cents',100)))),
    ('equipment: paid from another user''s account','23514', format('select record_equipment(''X'',''2026-06-01'',100,%L::jsonb)', json_build_array(json_build_object('kind','account','account_id',b_chk,'amount_cents',100)))),
    ('equipment: financing without a name','23514', 'select record_equipment(''X'',''2026-06-01'',1000,''[{"kind":"loan","name":" ","amount_cents":1000}]''::jsonb)'),
    ('equipment: financing name clashes with an account','23505', 'select record_equipment(''X'',''2026-06-01'',1000,''[{"kind":"loan","name":"Truck loan","amount_cents":1000}]''::jsonb)')
  ) as v(label, code, s)
  loop
    select count(*) into n from loans; select n + count(*) into n from loan_payments; select n + count(*) into n from fixed_assets;
    begin execute t.s; failures := failures || ('FAIL accepted: ' || t.label);
    exception when others then
      if sqlstate = t.code and (select count(*) from loans) + (select count(*) from loan_payments) + (select count(*) from fixed_assets) = n
      then results := results || ('PASS rejected: ' || t.label);
      else failures := failures || ('FAIL ' || t.label || ' -> ' || sqlstate || ' ' || sqlerrm); end if;
    end;
  end loop;

  -- ---- edit a payment = reversal + repost (different split and bank) ----
  perform update_loan_payment(p1, '2026-07-02', 25000, 2000, sav, 'edited');
  if pg_temp.bal(l1a) = 465000 and pg_temp.bal(intx) = 3500 and pg_temp.bal(sav) = -27000 and pg_temp.bal(chk) = 588500
     and (select count(*) from journal_entry_trace where source_id = p1::text) = 3
     and (select count(*) from journal_entry_trace where source_id = p1::text and status = 'active') = 1
  then results := results || 'PASS edited loan payment: old entry reversed, replacement posted with the new split and account'::text;
  else failures := failures || ('FAIL payment edit ' || pg_temp.bal(l1a) || '/' || pg_temp.bal(intx) || '/' || pg_temp.bal(sav) || '/' || pg_temp.bal(chk)); end if;
  begin perform update_loan_payment(p2, '2026-08-01', 999999, 0, chk); failures := failures || 'FAIL edit pushed principal over the loan';
  exception when others then if sqlstate = '23514' then results := results || 'PASS editing a payment cannot push principal paid over the loan amount'::text; else failures := failures || ('FAIL edit over ' || sqlstate); end if; end;

  perform void_loan_payment(p3);
  if pg_temp.bal(l1a) = 475000 and pg_temp.bal(chk) = 598500 and (select voided_at is not null from loan_payments where id = p3)
     and not exists (select 1 from journal_entry_trace where source_id = p3::text and status = 'active')
  then results := results || 'PASS void loan payment: entry reversed, row kept for history'::text; else failures := failures || ('FAIL void payment ' || pg_temp.bal(l1a)); end if;
  perform void_loan_payment(p3);
  results := results || 'PASS voiding a loan payment twice is a no-op'::text;
  begin perform update_loan_payment(p3, '2026-08-02', 100, 0, chk); failures := failures || 'FAIL edited voided payment';
  exception when others then if sqlstate = '23514' then results := results || 'PASS a voided loan payment cannot be edited'::text; else failures := failures || ('FAIL voided edit ' || sqlstate); end if; end;

  -- ---- the loan itself is locked while payments exist ----
  begin perform update_loan(l1, 'Truck loan', 'First Bank', 400000, '2026-06-01', chk); failures := failures || 'FAIL edited loan with live payments';
  exception when others then if sqlstate = '23514' then results := results || 'PASS a loan with live payments cannot be edited'::text; else failures := failures || ('FAIL loan edit ' || sqlstate); end if; end;
  begin perform void_loan(l1); failures := failures || 'FAIL voided loan with live payments';
  exception when others then if sqlstate = '23514' then results := results || 'PASS a loan with live payments cannot be voided'::text; else failures := failures || ('FAIL loan void ' || sqlstate); end if; end;

  -- ---- equipment bought with a bank account: Dr Equipment / Cr bank; not an expense (inv 17) ----
  a2 := record_equipment('Trailer', '2026-06-06', 800000, json_build_array(json_build_object('kind','account','account_id',chk,'amount_cents',800000))::jsonb, 'cash');
  if pg_temp.bal(eqp) = 800000 and pg_temp.bal(chk) = 598500 - 800000 and pg_temp.pl(a) = -3500
     and (select source_type from journal_entries where source_id = a2::text and reverses_entry_id is null) = 'equipment'
  then results := results || 'PASS inv 17: equipment bought with cash posts Dr Equipment / Cr bank; no expense'::text;
  else failures := failures || ('FAIL equipment purchase ' || pg_temp.bal(eqp) || '/' || pg_temp.bal(chk) || '/' || pg_temp.pl(a)); end if;
  perform update_equipment(a2, 'Trailer', '2026-06-07', 750000, json_build_array(json_build_object('kind','account','account_id',sav,'amount_cents',750000))::jsonb, 'edited');
  if pg_temp.bal(eqp) = 750000 and pg_temp.bal(chk) = 598500 and pg_temp.bal(sav) = -27000 - 750000
     and (select count(*) from journal_entry_trace where source_id = a2::text) = 3
  then results := results || 'PASS edited equipment purchase: reversal + repost with new cost, date and account'::text;
  else failures := failures || ('FAIL equipment edit ' || pg_temp.bal(eqp) || '/' || pg_temp.bal(chk) || '/' || pg_temp.bal(sav)); end if;

  -- ---- financed equipment: Dr Equipment / Cr new loan; no cash, no expense (inv 17) ----
  a1 := record_equipment('Excavator', '2026-06-05', 3000000, '[{"kind":"loan","name":"Excavator","lender":"CAT Financial","interest_rate_bps":500,"amount_cents":3000000}]'::jsonb, 'financed');
  select loan_id into l2 from fixed_asset_funding where asset_id = a1; select account_id into l2a from loans where id = l2;
  if pg_temp.bal(eqp) = 750000 + 3000000 and pg_temp.bal(l2a) = 3000000 and pg_temp.bal(chk) = 598500 and pg_temp.pl(a) = -3500
     and (select origin from loans where id = l2) = 'financed_asset'
     and (select source_type from journal_entries where source_id = a1::text and reverses_entry_id is null) = 'equipment'
     and not exists (select 1 from journal_entries where source_id = l2::text)
  then results := results || 'PASS inv 17: financed equipment records the asset and the loan; no cash movement and no full-price expense'::text;
  else failures := failures || ('FAIL financed equipment ' || pg_temp.bal(eqp) || '/' || pg_temp.bal(l2a) || '/' || pg_temp.bal(chk) || '/' || pg_temp.pl(a)); end if;
  p4 := record_loan_payment(l2, '2026-07-05', 50000, 12000, chk);
  if pg_temp.bal(l2a) = 2950000 and pg_temp.bal(intx) = 3500 + 12000 and pg_temp.pl(a) = -15500
  then results := results || 'PASS payments on financed equipment reduce its loan; only interest hits P&L'::text;
  else failures := failures || ('FAIL financed payment ' || pg_temp.bal(l2a) || '/' || pg_temp.bal(intx)); end if;
  for t in select * from (values
    ('financed equipment cannot shrink below principal already paid', '23514', format('select update_equipment(%L,''X'',''2026-06-05'',100,%L::jsonb)', a1, json_build_array(json_build_object('kind','loan','name','Excavator','loan_id',l2,'amount_cents',100)))),
    ('financed loan cannot be edited on its own',    '23514', format('select update_loan(%L,''X'',null,100,''2026-06-05'',%L)', l2, chk)),
    ('financed loan cannot be voided on its own',    '23514', format('select void_loan(%L)', l2)),
    ('financed equipment cannot be voided while its loan has payments', '23514', format('select void_fixed_asset(%L)', a1))
  ) as v(label, code, s)
  loop
    -- some of these rules are deferred constraint checks, so force them to run inside the exception block
    begin execute t.s; set constraints all immediate; failures := failures || ('FAIL accepted: ' || t.label);
    exception when others then
      if sqlstate = t.code then results := results || ('PASS rejected: ' || t.label);
      else failures := failures || ('FAIL ' || t.label || ' -> ' || sqlstate || ' ' || sqlerrm); end if;
    end;
    set constraints all deferred;
  end loop;

  -- ---- ledger entries of loans / payments / equipment cannot be reversed behind their backs ----
  for t in select * from (values ('loan', l1), ('loan payment', p1), ('equipment', a1)) as v(label, src)
  loop
    select id into e from journal_entry_trace where source_id = t.src::text and status = 'active';
    begin
      perform pg_temp.reverse_journal_entry(e);
      set constraints all immediate;
      failures := failures || ('FAIL ' || t.label || ' entry reversed behind its back');
    exception when others then
      if sqlstate = '23514' then results := results || ('PASS DB: a ' || t.label || ' ledger entry cannot be reversed without voiding it');
      else failures := failures || ('FAIL direct reverse ' || t.label || ' ' || sqlstate || ' ' || sqlerrm); end if;
    end;
    set constraints all deferred;
  end loop;

  -- ---- database-level consistency (privileged role: only triggers/constraints stand in the way) ----
  reset role;
  for t in select * from (values
    ('loan amount changed without reposting',        '23514', format('update loans set principal_cents = 600000 where id = %L', l1)),
    ('loan cut below the principal already paid',    '23514', format('update loans set principal_cents = 5000 where id = %L', l1)),
    ('loan date changed without reposting',          '23514', format('update loans set opened_date = ''2026-06-02'' where id = %L', l1)),
    ('loan voided without reversing the ledger',     '23514', format('update loans set voided_at = now() where id = %L', l1)),
    ('loan inserted without a ledger entry',         '23514', format('insert into loans (user_id,name,origin,principal_cents,opened_date,account_id,proceeds_account_id) values (%L,''x'',''cash'',100,''2026-06-01'',%L,%L)', a, draws, chk)),
    ('financed loan with no equipment behind it',    '23514', format('insert into loans (user_id,name,origin,principal_cents,opened_date,account_id) values (%L,''x'',''financed_asset'',100,''2026-06-01'',%L)', a, draws)),
    ('cash loan with no deposit account',            '23514', format('insert into loans (user_id,name,origin,principal_cents,opened_date,account_id) values (%L,''x'',''cash'',100,''2026-06-01'',%L)', a, draws)),
    ('loan payment amount changed without reposting','23514', format('update loan_payments set interest_cents = 9999 where id = %L', p1)),
    ('loan payment split swapped (same total)',      '23514', format('update loan_payments set principal_cents = 2000, interest_cents = 25000 where id = %L', p1)),
    ('loan payment account changed without reposting','23514', format('update loan_payments set paid_from_account_id = %L where id = %L', chk, p1)),
    ('loan payment voided without reversing',        '23514', format('update loan_payments set voided_at = now() where id = %L', p1)),
    ('loan payment dated before its loan',           '23514', format('update loan_payments set payment_date = ''2026-05-01'' where id = %L', p1)),
    ('loan payment with nothing paid',               '23514', format('insert into loan_payments (user_id,loan_id,payment_date,principal_cents,interest_cents,paid_from_account_id) values (%L,%L,''2026-09-01'',0,0,%L)', a, l1, chk)),
    ('loan payment inserted without a ledger entry', '23514', format('insert into loan_payments (user_id,loan_id,payment_date,principal_cents,interest_cents,paid_from_account_id) values (%L,%L,''2026-09-01'',100,10,%L)', a, l1, chk)),
    ('loan payment on another user''s loan',         '23503', format('insert into loan_payments (user_id,loan_id,payment_date,principal_cents,interest_cents,paid_from_account_id) values (%L,%L,''2026-09-01'',100,10,%L)', b, l1, b_chk)),
    ('loan payment from another user''s account',    '23503', format('insert into loan_payments (user_id,loan_id,payment_date,principal_cents,interest_cents,paid_from_account_id) values (%L,%L,''2026-09-01'',100,10,%L)', a, l1, b_chk)),
    ('equipment cost changed without reposting',     '23514', format('update fixed_assets set cost_cents = 760000 where id = %L', a2)),
    ('financed equipment cost changed without reposting','23514', format('update fixed_assets set cost_cents = 3100000 where id = %L', a1)),
    ('equipment voided without reversing',           '23514', format('update fixed_assets set voided_at = now() where id = %L', a2)),
    ('equipment funded by nothing',                  '23514', format('delete from fixed_asset_funding where asset_id = %L', a2)),
    ('equipment funded by an extra loan beyond its cost','23514', format('insert into fixed_asset_funding (user_id,asset_id,kind,loan_id,amount_cents) values (%L,%L,''loan'',%L,1)', a, a2, l1)),
    ('equipment inserted without funding',           '23514', format('insert into fixed_assets (user_id,name,acquired_date,cost_cents) values (%L,''x'',''2026-06-01'',500)', a)),
    ('delete a live loan',                           '23503', format('delete from loans where id = %L', l1)),
    ('delete a live loan payment',                   '23503', format('delete from loan_payments where id = %L', p1)),
    ('delete live equipment',                        '23503', format('delete from fixed_assets where id = %L', a2))
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

  -- ---- other users and roles ----
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  for t in select * from (values
    ('B updating A''s loan',           'P0002', format('select update_loan(%L,''X'',null,100,''2026-06-01'',%L)', l1, b_chk)),
    ('B voiding A''s loan',            'P0002', format('select void_loan(%L)', l1)),
    ('B paying A''s loan',             'P0002', format('select record_loan_payment(%L,''2026-09-01'',100,0,%L)', l1, b_chk)),
    ('B editing A''s loan payment',    'P0002', format('select update_loan_payment(%L,''2026-09-01'',100,0,%L)', p1, b_chk)),
    ('B voiding A''s loan payment',    'P0002', format('select void_loan_payment(%L)', p1)),
    ('B editing A''s equipment',       'P0002', format('select update_equipment(%L,''X'',''2026-06-01'',100,''[]''::jsonb)', a2)),
    ('B voiding A''s equipment',       'P0002', format('select void_fixed_asset(%L)', a2)),
    ('B taking a loan into A''s account','23514', format('select record_loan(''B loan'',null,100,''2026-06-01'',%L)', chk)),
    ('authenticated INSERT loans',      '42501', 'insert into loans (user_id,name,origin,principal_cents,opened_date,account_id) values (auth.uid(),''x'',''financed_asset'',1,''2026-06-01'',gen_random_uuid())'),
    ('authenticated UPDATE loan_payments','42501', 'update loan_payments set principal_cents = 1'),
    ('authenticated DELETE fixed_assets','42501', 'delete from fixed_assets')
  ) as v(label, code, s)
  loop
    begin execute t.s; failures := failures || ('FAIL accepted: ' || t.label);
    exception when others then
      if sqlstate = t.code then results := results || ('PASS rejected: ' || t.label);
      else failures := failures || ('FAIL ' || t.label || ' -> ' || sqlstate || ' ' || sqlerrm); end if;
    end;
  end loop;
  select count(*) into n from loans; select n + count(*) into n from loan_payments; select n + count(*) into n from fixed_assets;
  if n = 0 then results := results || 'PASS B sees none of A''s loans, payments or equipment'::text; else failures := failures || 'FAIL B sees A rows'; end if;
  reset role;

  perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  set local role authenticated;
  begin perform record_loan('X',null,100,'2026-06-01',chk); failures := failures || 'FAIL unauth';
  exception when others then if sqlstate = '28000' then results := results || 'PASS not signed in is refused'::text; else failures := failures || ('FAIL unauth ' || sqlstate); end if; end;
  reset role;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  begin perform record_loan('X',null,100,'2026-06-01',chk); failures := failures || 'FAIL anon';
  exception when insufficient_privilege then results := results || 'PASS anon cannot execute record_loan'::text; end;
  begin perform 1 from loans; failures := failures || 'FAIL anon read loans';
  exception when insufficient_privilege then results := results || 'PASS anon cannot read loans'::text; end;
  reset role;

  -- ---- lifecycle: void payments -> edit loan -> void loan; void financed equipment with its loan ----
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform void_loan_payment(p1); perform void_loan_payment(p2);
  perform update_loan(l1, 'Truck loan 2', 'First Bank', 400000, '2026-06-02', sav, 500, 'renamed');
  if pg_temp.bal(l1a) = 400000 and exists (select 1 from accounts where id = l1a and name = 'Loan - Truck loan 2')
     and (select count(*) from journal_entry_trace where source_id = l1::text and status = 'active') = 1
  then results := results || 'PASS edited loan (no live payments): reversal + repost, loan account renamed'::text;
  else failures := failures || ('FAIL loan edit ' || pg_temp.bal(l1a)); end if;
  perform void_loan(l1);
  if pg_temp.bal(l1a) = 0 and exists (select 1 from accounts where id = l1a and not is_active) and (select voided_at is not null from loans where id = l1)
  then results := results || 'PASS void loan: entry reversed, account retired, row kept for history'::text; else failures := failures || 'FAIL void loan'; end if;
  begin perform record_loan_payment(l1, '2026-09-01', 100, 0, chk); failures := failures || 'FAIL paid a voided loan';
  exception when others then if sqlstate = '23514' then results := results || 'PASS a voided loan cannot receive payments'::text; else failures := failures || ('FAIL pay voided ' || sqlstate); end if; end;

  perform void_loan_payment(p4);
  perform void_fixed_asset(a1);
  if pg_temp.bal(l2a) = 0 and pg_temp.bal(eqp) = 750000 and (select voided_at is not null from loans where id = l2)
     and (select voided_at is not null from fixed_assets where id = a1)
  then results := results || 'PASS void financed equipment: asset and its loan reversed together'::text; else failures := failures || ('FAIL void financed ' || pg_temp.bal(l2a) || '/' || pg_temp.bal(eqp)); end if;
  perform void_fixed_asset(a2);
  if pg_temp.bal(eqp) = 0 then results := results || 'PASS void equipment purchase reverses Dr Equipment / Cr bank'::text; else failures := failures || 'FAIL void equipment'; end if;
  perform void_fixed_asset(a2);
  results := results || 'PASS voiding equipment twice is a no-op'::text;
  begin set constraints all immediate; results := results || 'PASS commit-time checks hold after the full lifecycle as the signed-in role'::text;
  exception when others then failures := failures || ('FAIL lifecycle commit ' || sqlstate || ' ' || sqlerrm); end;
  set constraints all deferred;
  reset role;

  select sum(debit_total), sum(credit_total) into v, v2 from account_balances where user_id = a;
  if v = v2 then results := results || 'PASS inv 8: debits = credits'::text; else failures := failures || 'FAIL inv 8'; end if;
  select
    coalesce(sum(balance_cents) filter (where type='asset'),0) - coalesce(sum(balance_cents) filter (where type='liability'),0),
    coalesce(sum(balance_cents) filter (where type='equity'),0) + coalesce(sum(balance_cents) filter (where type='income'),0) - coalesce(sum(balance_cents) filter (where type='expense'),0)
  into v, v2 from account_balances where user_id = a;
  if v = v2 then results := results || 'PASS inv 9/10: assets - liabilities = equity + (income - expenses)'::text; else failures := failures || ('FAIL inv 9 ' || v || '/' || v2); end if;

  -- ---- deleting a user cascades through loans, payments, equipment and the immutable ledger ----
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform record_loan_payment(record_loan('C loan', null, 10000, '2026-06-01', c_chk), '2026-07-01', 1000, 100, c_chk);
  perform record_equipment('C machine', '2026-06-02', 5000, '[{"kind":"loan","name":"C machine","amount_cents":5000}]'::jsonb);
  reset role;
  begin
    set constraints all immediate; set constraints all deferred;
    delete from auth.users where id = c;
    select count(*) into n from loans where user_id = c; select n + count(*) into n from loan_payments where user_id = c;
    select n + count(*) into n from fixed_assets where user_id = c; select n + count(*) into n from journal_entries where user_id = c;
    if n = 0 then results := results || 'PASS deleting a user removes their loans, payments, equipment and ledger'::text; else failures := failures || 'FAIL user delete left rows'; end if;
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
