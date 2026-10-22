-- Stage D5 tests: ONE equipment acquisition funded by one or more sources (bank, credit card, "paid personally", new loan),
-- ONE balanced journal entry, negative balances allowed, DB-enforced consistency, ownership. One DO block, always rolls back.
-- Success = message starts 'ROLLED BACK - ALL PASS'.
do $test$
declare
  a uuid := '00000000-0000-4000-8000-0000000000aa';
  b uuid := '00000000-0000-4000-8000-0000000000bb';
  c uuid := '00000000-0000-4000-8000-0000000000cc';
  chk uuid; sav uuid; card uuid; b_chk uuid; c_chk uuid; ar uuid; eqp uuid; contribs uuid; intx uuid;
  e1 uuid; e2 uuid; e3 uuid; e4 uuid; e5 uuid; e6 uuid; e7 uuid; l1 uuid; l4 uuid; l4a uuid; l5 uuid; l5a uuid; l6 uuid; l6a uuid;
  ent uuid; pay uuid;
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
  select id into contribs from accounts where user_id=a and system_key='owner_contributions';
  select id into intx from accounts where user_id=a and system_key='interest_expense';
  execute 'create function pg_temp.bal(p uuid) returns bigint language sql as $f$ select balance_cents from account_balances where account_id = p $f$';
  execute 'create function pg_temp.pl(u uuid) returns bigint language sql as $f$ select coalesce(sum(case when type = ''income'' then balance_cents else -balance_cents end),0) from account_balances where user_id = u and type in (''income'',''expense'') $f$';
  execute 'create function pg_temp.fa(acc uuid, amt bigint) returns jsonb language sql as $f$ select jsonb_build_object(''kind'',''account'',''account_id'',acc,''amount_cents'',amt) $f$';
  execute 'create function pg_temp.fo(amt bigint) returns jsonb language sql as $f$ select jsonb_build_object(''kind'',''owner'',''amount_cents'',amt) $f$';
  execute 'create function pg_temp.fl(nm text, amt bigint, lid uuid default null) returns jsonb language sql as $f$ select jsonb_build_object(''kind'',''loan'',''name'',nm,''lender'',''Lender'',''interest_rate_bps'',500,''amount_cents'',amt,''loan_id'',lid) $f$';
  execute 'create function pg_temp.lines(src uuid) returns int language sql as $f$ select count(*)::int from journal_lines l join journal_entry_trace t on t.id = l.entry_id where t.source_id = src::text and t.status = ''active'' $f$';
  execute 'create function pg_temp.entries(src uuid) returns int language sql as $f$ select count(*)::int from journal_entry_trace where source_id = src::text $f$';
  execute 'create function pg_temp.active(src uuid) returns int language sql as $f$ select count(*)::int from journal_entry_trace where source_id = src::text and status = ''active'' $f$';

  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform pg_temp.post_opening_balance(chk, 100000, '2026-06-01');
  l1 := record_loan('Cash loan', 'Bank', 50000, '2026-06-01', chk);   -- chk 150000

  -- ---- each single funding source ----
  e1 := record_equipment('Laptop', '2026-06-02', 30000, jsonb_build_array(pg_temp.fa(chk, 30000)));
  if pg_temp.bal(eqp) = 30000 and pg_temp.bal(chk) = 120000 and pg_temp.pl(a) = 0 and pg_temp.lines(e1) = 2
  then results := results || 'PASS bank only: Dr Equipment / Cr bank, no expense'::text;
  else failures := failures || ('FAIL bank only ' || pg_temp.bal(eqp) || '/' || pg_temp.bal(chk)); end if;
  begin set constraints all immediate; results := results || 'PASS commit-time ledger checks run correctly as the signed-in role'::text;
  exception when others then failures := failures || ('FAIL commit-time checks as authenticated: ' || sqlstate || ' ' || sqlerrm); end;
  set constraints all deferred;

  e2 := record_equipment('Saw', '2026-06-03', 20000, jsonb_build_array(pg_temp.fa(card, 20000)));
  if pg_temp.bal(eqp) = 50000 and pg_temp.bal(card) = 20000 and pg_temp.bal(chk) = 120000 and pg_temp.lines(e2) = 2
  then results := results || 'PASS credit card only: Dr Equipment / Cr card liability'::text;
  else failures := failures || ('FAIL card only ' || pg_temp.bal(card)); end if;

  e3 := record_equipment('Ladder', '2026-06-04', 10000, jsonb_build_array(pg_temp.fo(10000)));
  if pg_temp.bal(eqp) = 60000 and pg_temp.bal(contribs) = 10000 and pg_temp.bal(chk) = 120000 and pg_temp.pl(a) = 0
  then results := results || 'PASS paid personally: Dr Equipment / Cr Owner Contributions, no bank movement'::text;
  else failures := failures || ('FAIL owner only ' || pg_temp.bal(contribs)); end if;

  e4 := record_equipment('Skid steer', '2026-06-05', 400000, jsonb_build_array(pg_temp.fl('Skid steer loan', 400000)));
  select f.loan_id, l.account_id into l4, l4a from fixed_asset_funding f join loans l on l.id = f.loan_id where f.asset_id = e4;
  if pg_temp.bal(eqp) = 460000 and pg_temp.bal(l4a) = 400000 and pg_temp.bal(chk) = 120000
     and exists (select 1 from loans where id = l4 and origin = 'financed_asset' and principal_cents = 400000 and opened_date = '2026-06-05' and name = 'Skid steer loan')
     and exists (select 1 from accounts where id = l4a and name = 'Loan - Skid steer loan' and type = 'liability')
  then results := results || 'PASS financing only: Dr Equipment / Cr the new loan; no cash, no expense'::text;
  else failures := failures || ('FAIL loan only ' || pg_temp.bal(l4a)); end if;

  -- ---- the worked example: $50,000 equipment, $10,000 down payment, $40,000 financing = ONE asset, ONE entry ----
  select count(*) into n from fixed_assets;
  e5 := record_equipment('Excavator', '2026-06-06', 5000000, jsonb_build_array(pg_temp.fa(chk, 1000000), pg_temp.fl('Excavator loan', 4000000)));
  select f.loan_id, l.account_id into l5, l5a from fixed_asset_funding f join loans l on l.id = f.loan_id where f.asset_id = e5;
  if (select count(*) from fixed_assets) = n + 1 and pg_temp.entries(e5) = 1 and pg_temp.lines(e5) = 3
     and pg_temp.bal(eqp) = 5460000 and pg_temp.bal(chk) = 120000 - 1000000 and pg_temp.bal(l5a) = 4000000 and pg_temp.pl(a) = 0
     and (select sum(debit_cents) = 5000000 and sum(credit_cents) = 5000000 from journal_lines jl join journal_entry_trace jt on jt.id = jl.entry_id where jt.source_id = e5::text and jt.status = 'active')
     and not exists (select 1 from journal_entries where source_id = l5::text)
  then results := results || 'PASS $50,000 example: one asset, one entry: Dr Equipment 50000 / Cr bank 10000 / Cr loan 40000'::text;
  else failures := failures || ('FAIL example ' || pg_temp.entries(e5) || '/' || pg_temp.lines(e5) || '/' || pg_temp.bal(chk) || '/' || pg_temp.bal(l5a)); end if;
  -- bank went negative: the ledger reports reality, nothing blocks it
  if pg_temp.bal(chk) = -880000 then results := results || 'PASS a bank account may go negative'::text; else failures := failures || 'FAIL negative bank'; end if;

  -- ---- all sources at once, two rows to the same account aggregate ----
  e6 := record_equipment('Truck', '2026-06-07', 900000, jsonb_build_array(pg_temp.fa(card, 100000), pg_temp.fo(200000), pg_temp.fl('Truck loan', 300000), pg_temp.fa(sav, 300000)));
  select f.loan_id, l.account_id into l6, l6a from fixed_asset_funding f join loans l on l.id = f.loan_id where f.asset_id = e6;
  if pg_temp.bal(card) = 120000 and pg_temp.bal(contribs) = 210000 and pg_temp.bal(l6a) = 300000 and pg_temp.bal(sav) = -300000
     and pg_temp.bal(eqp) = 6360000 and pg_temp.lines(e6) = 5 and pg_temp.entries(e6) = 1
  then results := results || 'PASS card + owner + loan + bank in one entry (5 lines)'::text;
  else failures := failures || ('FAIL combo ' || pg_temp.bal(card) || '/' || pg_temp.bal(contribs) || '/' || pg_temp.bal(l6a) || '/' || pg_temp.bal(sav) || '/' || pg_temp.lines(e6)); end if;
  e7 := record_equipment('Tools', '2026-06-08', 5000, jsonb_build_array(pg_temp.fa(chk, 2000), pg_temp.fa(chk, 3000)));
  if pg_temp.lines(e7) = 2 and pg_temp.bal(chk) = -885000 and pg_temp.bal(eqp) = 6365000
  then results := results || 'PASS two funding rows from the same account post as one credit line'::text; else failures := failures || ('FAIL aggregate ' || pg_temp.lines(e7)); end if;

  -- ---- a credit card may cross through zero ----
  perform record_card_payment('2026-06-09', 150000, chk, card);
  if pg_temp.bal(card) = -30000 and pg_temp.bal(chk) = -1035000
  then results := results || 'PASS a credit card paid past its balance holds a credit (negative liability)'::text; else failures := failures || ('FAIL card past zero ' || pg_temp.bal(card)); end if;

  -- ---- rejected requests (nothing is left behind) ----
  for t in select * from (values
    ('zero cost',                  '23514', format('select record_equipment(''X'',''2026-06-01'',0,%L::jsonb)', jsonb_build_array(pg_temp.fa(chk, 1)))),
    ('blank name',                 '23514', format('select record_equipment('' '',''2026-06-01'',100,%L::jsonb)', jsonb_build_array(pg_temp.fa(chk, 100)))),
    ('no date',                    '23514', format('select record_equipment(''X'',null,100,%L::jsonb)', jsonb_build_array(pg_temp.fa(chk, 100)))),
    ('no funding',                 '23514', 'select record_equipment(''X'',''2026-06-01'',100,''[]''::jsonb)'),
    ('null funding',               '23514', 'select record_equipment(''X'',''2026-06-01'',100,null)'),
    ('funding short of the cost',  '23514', format('select record_equipment(''X'',''2026-06-01'',100,%L::jsonb)', jsonb_build_array(pg_temp.fa(chk, 90)))),
    ('funding over the cost',      '23514', format('select record_equipment(''X'',''2026-06-01'',100,%L::jsonb)', jsonb_build_array(pg_temp.fa(chk, 60), pg_temp.fo(60)))),
    ('zero funding amount',        '23514', format('select record_equipment(''X'',''2026-06-01'',100,%L::jsonb)', jsonb_build_array(pg_temp.fa(chk, 100), pg_temp.fo(0)))),
    ('negative funding amount',    '23514', format('select record_equipment(''X'',''2026-06-01'',100,%L::jsonb)', jsonb_build_array(pg_temp.fa(chk, 200), pg_temp.fo(-100)))),
    ('unknown funding kind',       '23514', 'select record_equipment(''X'',''2026-06-01'',100,''[{"kind":"barter","amount_cents":100}]''::jsonb)'),
    ('paid from A/R',              '23514', format('select record_equipment(''X'',''2026-06-01'',100,%L::jsonb)', jsonb_build_array(pg_temp.fa(ar, 100)))),
    ('paid from Equipment',        '23514', format('select record_equipment(''X'',''2026-06-01'',100,%L::jsonb)', jsonb_build_array(pg_temp.fa(eqp, 100)))),
    ('paid from Owner Contributions account directly','23514', format('select record_equipment(''X'',''2026-06-01'',100,%L::jsonb)', jsonb_build_array(pg_temp.fa(contribs, 100)))),
    ('paid from a loan account',   '23514', format('select record_equipment(''X'',''2026-06-01'',100,%L::jsonb)', jsonb_build_array(pg_temp.fa(l4a, 100)))),
    ('paid from another user''s account','23514', format('select record_equipment(''X'',''2026-06-01'',100,%L::jsonb)', jsonb_build_array(pg_temp.fa(b_chk, 100)))),
    ('financing without a name',   '23514', format('select record_equipment(''X'',''2026-06-01'',100,%L::jsonb)', jsonb_build_array(pg_temp.fl(' ', 100)))),
    ('financing name clashes with an account','23505', format('select record_equipment(''X'',''2026-06-01'',100,%L::jsonb)', jsonb_build_array(pg_temp.fl('Skid steer loan', 100)))),
    ('adopting another asset''s loan on create','23514', format('select update_equipment(%L,''Laptop'',''2026-06-02'',30000,%L::jsonb)', e1, jsonb_build_array(pg_temp.fl('Skid steer loan', 30000, l4)))),
    ('editing voided/unknown equipment','P0002', format('select update_equipment(gen_random_uuid(),''X'',''2026-06-01'',100,%L::jsonb)', jsonb_build_array(pg_temp.fa(chk, 100))))
  ) as v(label, code, s)
  loop
    select (select count(*) from fixed_assets) + (select count(*) from fixed_asset_funding) + (select count(*) from loans) + (select count(*) from accounts) into n;
    begin execute t.s; failures := failures || ('FAIL accepted: ' || t.label);
    exception when others then
      if sqlstate = t.code and (select count(*) from fixed_assets) + (select count(*) from fixed_asset_funding) + (select count(*) from loans) + (select count(*) from accounts) = n
      then results := results || ('PASS rejected, nothing left behind: ' || t.label);
      else failures := failures || ('FAIL ' || t.label || ' -> ' || sqlstate || ' ' || sqlerrm); end if;
    end;
  end loop;

  -- ---- edits are reversal + replacement ----
  select pg_temp.bal(chk) into v;
  perform update_equipment(e5, 'Excavator', '2026-06-06', 5000000, jsonb_build_array(pg_temp.fa(chk, 1000000), pg_temp.fl('Excavator loan', 4000000, l5)));
  if pg_temp.entries(e5) = 1 and pg_temp.bal(chk) = v
  then results := results || 'PASS an edit that changes nothing posts nothing'::text; else failures := failures || ('FAIL no-op edit ' || pg_temp.entries(e5)); end if;
  perform update_equipment(e5, 'Excavator', '2026-06-06', 5000000, jsonb_build_array(pg_temp.fa(chk, 2000000), pg_temp.fl('Excavator loan', 3000000, l5)), 'bigger down payment');
  if pg_temp.bal(chk) = v - 1000000 and pg_temp.bal(l5a) = 3000000 and pg_temp.bal(eqp) = 6365000 + 0
     and pg_temp.entries(e5) = 3 and pg_temp.active(e5) = 1 and (select principal_cents from loans where id = l5) = 3000000
     and (select count(*) from loans where id = l5) = 1
  then results := results || 'PASS edit the split: same loan kept and updated, old entry reversed, replacement posted'::text;
  else failures := failures || ('FAIL edit split ' || pg_temp.bal(chk) || '/' || pg_temp.bal(l5a) || '/' || pg_temp.entries(e5)); end if;
  perform update_equipment(e5, 'Excavator', '2026-06-06', 5000000, jsonb_build_array(pg_temp.fa(chk, 5000000)));
  if pg_temp.bal(l5a) = 0 and pg_temp.bal(chk) = v - 4000000 and (select voided_at is not null from loans where id = l5)
     and exists (select 1 from accounts where id = l5a and not is_active) and pg_temp.active(e5) = 1
  then results := results || 'PASS edit to remove financing: loan voided, its account retired, one active entry'::text;
  else failures := failures || ('FAIL remove financing ' || pg_temp.bal(l5a) || '/' || pg_temp.bal(chk)); end if;
  perform update_equipment(e5, 'Excavator', '2026-06-06', 5000000, jsonb_build_array(pg_temp.fa(chk, 1000000), pg_temp.fl('Excavator loan 2', 4000000)));
  if (select count(*) from fixed_asset_funding where asset_id = e5) = 2 and pg_temp.lines(e5) = 3 and pg_temp.bal(chk) = v
  then results := results || 'PASS edit to add financing back: a new loan is created'::text; else failures := failures || 'FAIL re-add financing'; end if;
  perform update_equipment(e1, 'Laptop', '2026-06-02', 30000, jsonb_build_array(pg_temp.fa(sav, 10000), pg_temp.fo(20000)));
  if pg_temp.bal(sav) = -310000 and pg_temp.bal(contribs) = 230000 and pg_temp.lines(e1) = 3
  then results := results || 'PASS edit a funding change from bank to part savings, part owner'::text; else failures := failures || ('FAIL edit funding ' || pg_temp.bal(sav) || '/' || pg_temp.bal(contribs)); end if;

  -- ---- payments on a funded loan ----
  pay := record_loan_payment(l4, '2026-07-01', 50000, 1000, chk);
  if pg_temp.bal(l4a) = 350000 and pg_temp.bal(intx) = 1000 and pg_temp.pl(a) = -1000
  then results := results || 'PASS payments on a funded loan reduce it; only interest is an expense'::text; else failures := failures || ('FAIL loan payment ' || pg_temp.bal(l4a)); end if;
  for t in select * from (values
    ('cannot remove financing that has payments', '23514', format('select update_equipment(%L,''Skid steer'',''2026-06-05'',400000,%L::jsonb)', e4, jsonb_build_array(pg_temp.fa(chk, 400000)))),
    ('cannot shrink financing below principal paid','23514', format('select update_equipment(%L,''Skid steer'',''2026-06-05'',40000,%L::jsonb)', e4, jsonb_build_array(pg_temp.fl('Skid steer loan', 40000, l4)))),
    ('cannot void equipment whose loan has payments','23514', format('select void_fixed_asset(%L)', e4)),
    ('cannot void the funding loan on its own',   '23514', format('select void_loan(%L)', l4))
  ) as v(label, code, s)
  loop
    begin execute t.s; set constraints all immediate; failures := failures || ('FAIL accepted: ' || t.label);
    exception when others then
      if sqlstate = t.code and pg_temp.bal(l4a) = 350000 and pg_temp.active(e4) = 1 then results := results || ('PASS rejected: ' || t.label);
      else failures := failures || ('FAIL ' || t.label || ' -> ' || sqlstate || ' ' || sqlerrm); end if;
    end;
    set constraints all deferred;
  end loop;

  -- ---- entries cannot be reversed behind the equipment's back ----
  select id into ent from journal_entry_trace where source_id = e6::text and status = 'active';
  begin perform pg_temp.reverse_journal_entry(ent); set constraints all immediate; failures := failures || 'FAIL equipment entry reversed behind its back';
  exception when others then
    if sqlstate = '23514' then results := results || 'PASS DB: an equipment ledger entry cannot be reversed without voiding the equipment'::text;
    else failures := failures || ('FAIL direct reverse ' || sqlstate || ' ' || sqlerrm); end if;
  end;
  set constraints all deferred;

  -- ---- database-level consistency (privileged role: only triggers/constraints stand in the way) ----
  reset role;
  for t in select * from (values
    ('funding amount changed without reposting',      '23514', format('update fixed_asset_funding set amount_cents = amount_cents + 1 where asset_id = %L and kind = ''account''', e1)),
    ('all funding deleted',                           '23514', format('delete from fixed_asset_funding where asset_id = %L', e2)),
    ('funding pointed at A/R',                        '23514', format('update fixed_asset_funding set account_id = %L where asset_id = %L', ar, e2)),
    ('funding pointed at Interest Expense',           '23514', format('update fixed_asset_funding set account_id = %L where asset_id = %L', intx, e2)),
    ('funding pointed at another bank account (no repost)','23514', format('update fixed_asset_funding set account_id = %L where asset_id = %L', chk, e2)),
    ('funding pointed at another user''s account',    '23503', format('update fixed_asset_funding set account_id = %L where asset_id = %L', b_chk, e2)),
    ('extra funding beyond the cost',                 '23514', format('insert into fixed_asset_funding (user_id,asset_id,kind,loan_id,amount_cents) values (%L,%L,''loan'',%L,1)', a, e2, l1)),
    ('same loan funding two assets',                  '23505', format('insert into fixed_asset_funding (user_id,asset_id,kind,loan_id,amount_cents) values (%L,%L,''loan'',%L,400000)', a, e2, l4)),
    ('owner funding that also names an account',      '23514', format('insert into fixed_asset_funding (user_id,asset_id,kind,account_id,amount_cents) values (%L,%L,''owner'',%L,1)', a, e2, chk)),
    ('account funding with no account',               '23514', format('insert into fixed_asset_funding (user_id,asset_id,kind,amount_cents) values (%L,%L,''account'',1)', a, e2)),
    ('zero funding amount',                           '23514', format('insert into fixed_asset_funding (user_id,asset_id,kind,amount_cents) values (%L,%L,''owner'',0)', a, e2)),
    ('funding for another user''s asset',             '23503', format('insert into fixed_asset_funding (user_id,asset_id,kind,amount_cents) values (%L,%L,''owner'',1)', b, e2)),
    ('equipment cost changed without reposting',      '23514', format('update fixed_assets set cost_cents = cost_cents + 1 where id = %L', e2)),
    ('equipment date changed without reposting',      '23514', format('update fixed_assets set acquired_date = ''2026-06-30'' where id = %L', e2)),
    ('financed equipment date changed (loan date no longer matches)','23514', format('update fixed_assets set acquired_date = ''2026-06-30'' where id = %L', e6)),
    ('equipment voided without reversing',            '23514', format('update fixed_assets set voided_at = now() where id = %L', e2)),
    ('equipment with funding voided but loan left live','23514', format('update fixed_assets set voided_at = now() where id = %L', e4)),
    ('financing loan voided but equipment left live', '23514', format('update loans set voided_at = now() where id = %L', l6)),
    ('financing loan amount changed alone',           '23514', format('update loans set principal_cents = principal_cents + 1 where id = %L', l6)),
    ('financing loan date changed alone',             '23514', format('update loans set opened_date = ''2026-06-30'' where id = %L', l6)),
    ('equipment inserted with no funding',            '23514', format('insert into fixed_assets (user_id,name,acquired_date,cost_cents) values (%L,''x'',''2026-06-01'',500)', a)),
    ('delete live equipment',                         '23503', format('delete from fixed_assets where id = %L', e2))
  ) as v(label, code, s)
  loop
    begin execute t.s; set constraints all immediate; failures := failures || ('FAIL accepted: ' || t.label);
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
    ('B editing A''s equipment',            'P0002', format('select update_equipment(%L,''X'',''2026-06-01'',100,%L::jsonb)', e2, jsonb_build_array(pg_temp.fa(b_chk, 100)))),
    ('B voiding A''s equipment',            'P0002', format('select void_fixed_asset(%L)', e2)),
    ('B funding equipment from A''s account','23514', format('select record_equipment(''X'',''2026-06-01'',100,%L::jsonb)', jsonb_build_array(pg_temp.fa(chk, 100)))),
    ('B adopting A''s loan',                'P0002', format('select update_equipment(%L,''X'',''2026-06-01'',100,%L::jsonb)', e2, jsonb_build_array(pg_temp.fl('x', 100, l4)))),
    ('authenticated INSERT funding',        '42501', 'insert into fixed_asset_funding (user_id,asset_id,kind,amount_cents) values (auth.uid(),gen_random_uuid(),''owner'',1)'),
    ('authenticated UPDATE funding',        '42501', 'update fixed_asset_funding set amount_cents = 1'),
    ('authenticated DELETE funding',        '42501', 'delete from fixed_asset_funding'),
    ('authenticated calls the posting helper','42501', format('select _asset_legs(%L)', e2))
  ) as v(label, code, s)
  loop
    begin execute t.s; failures := failures || ('FAIL accepted: ' || t.label);
    exception when others then
      if sqlstate = t.code then results := results || ('PASS rejected: ' || t.label);
      else failures := failures || ('FAIL ' || t.label || ' -> ' || sqlstate || ' ' || sqlerrm); end if;
    end;
  end loop;
  select count(*) into n from fixed_asset_funding; select n + count(*) into n from fixed_assets;
  if n = 0 then results := results || 'PASS B sees none of A''s equipment or funding'::text; else failures := failures || 'FAIL B sees A rows'; end if;
  reset role;

  perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  set local role authenticated;
  begin perform record_equipment('X','2026-06-01',100,jsonb_build_array(pg_temp.fo(100))); failures := failures || 'FAIL unauth';
  exception when others then if sqlstate = '28000' then results := results || 'PASS not signed in is refused'::text; else failures := failures || ('FAIL unauth ' || sqlstate); end if; end;
  reset role;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  begin perform record_equipment('X','2026-06-01',100,jsonb_build_array(pg_temp.fo(100))); failures := failures || 'FAIL anon';
  exception when insufficient_privilege then results := results || 'PASS anon cannot execute record_equipment'::text; end;
  begin perform 1 from fixed_asset_funding; failures := failures || 'FAIL anon read funding';
  exception when insufficient_privilege then results := results || 'PASS anon cannot read funding'::text; end;
  reset role;

  -- ---- lifecycle: void ----
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v := pg_temp.bal(eqp);
  perform void_fixed_asset(e6);
  if pg_temp.bal(eqp) = v - 900000 and pg_temp.bal(l6a) = 0 and pg_temp.bal(sav) = -10000 and pg_temp.bal(contribs) = 30000 - 200000 + 200000
     and (select voided_at is not null from loans where id = l6) and exists (select 1 from accounts where id = l6a and not is_active)
     and pg_temp.active(e6) = 0
  then results := results || 'PASS void multi-source equipment: every source reversed, financing loan voided and retired'::text;
  else failures := failures || ('FAIL void multi ' || pg_temp.bal(eqp) || '/' || pg_temp.bal(l6a) || '/' || pg_temp.bal(sav) || '/' || pg_temp.bal(contribs)); end if;
  perform void_fixed_asset(e6);
  results := results || 'PASS voiding equipment twice is a no-op'::text;
  begin perform update_equipment(e6, 'x', '2026-06-07', 100, jsonb_build_array(pg_temp.fo(100))); failures := failures || 'FAIL edited voided';
  exception when others then if sqlstate = '23514' then results := results || 'PASS voided equipment cannot be edited'::text; else failures := failures || ('FAIL voided edit ' || sqlstate); end if; end;
  perform void_loan_payment(pay);
  perform void_fixed_asset(e4);
  if pg_temp.bal(l4a) = 0 and (select voided_at is not null from loans where id = l4)
  then results := results || 'PASS after its payment is voided the financed equipment can be voided'::text; else failures := failures || 'FAIL void e4'; end if;
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
  if (select count(*) from fixed_assets fa where voided_at is null and not exists (select 1 from journal_entry_trace jt where jt.source_id = fa.id::text and jt.status = 'active')) = 0
     and (select count(*) from fixed_assets fa where voided_at is not null and exists (select 1 from journal_entry_trace jt where jt.source_id = fa.id::text and jt.status = 'active')) = 0
  then results := results || 'PASS every live asset has exactly its active entry; no voided asset does'::text; else failures := failures || 'FAIL asset/entry correspondence'; end if;

  -- ---- deleting a user cascades through equipment, funding and the immutable ledger ----
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform record_equipment('C machine', '2026-06-02', 5000, jsonb_build_array(pg_temp.fa(c_chk, 1000), pg_temp.fl('C machine loan', 4000)));
  reset role;
  begin
    set constraints all immediate; set constraints all deferred;
    delete from auth.users where id = c;
    select count(*) into n from fixed_assets where user_id = c; select n + count(*) into n from fixed_asset_funding where user_id = c;
    select n + count(*) into n from loans where user_id = c; select n + count(*) into n from journal_entries where user_id = c;
    if n = 0 then results := results || 'PASS deleting a user removes their equipment, funding, loans and ledger'::text; else failures := failures || 'FAIL user delete left rows'; end if;
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
