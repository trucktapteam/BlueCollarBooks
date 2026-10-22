-- Stage D4 tests: credit-card purchases then card payments (inv 18), kind rules enforced by the database, ownership.
-- One DO block, always rolls back. Success = message starts 'ROLLED BACK - ALL PASS'.
do $test$
declare
  a uuid := '00000000-0000-4000-8000-0000000000aa';
  b uuid := '00000000-0000-4000-8000-0000000000bb';
  chk uuid; sav uuid; card uuid; b_chk uuid; b_card uuid; ar uuid; fuel uuid;
  cp1 uuid; cp2 uuid; cp3 uuid; e uuid; n int; v bigint; v2 bigint; t record;
  results text[] := '{}'; failures text[] := '{}';
begin
  insert into auth.users (id,email,aud,role) values
    (a,'ta@example.invalid','authenticated','authenticated'),(b,'tb@example.invalid','authenticated','authenticated');
  insert into bank_accounts (id,user_id,name,last4,balance,last_updated,subtype) values
    ('bk1',a,'Checking','1111',0,'x',null),('bk2',a,'Savings','2222',0,'x',null),('bk3',a,'Visa','3333',0,'x','credit card'),
    ('bkb',b,'B Checking','9999',0,'x',null),('bkbc',b,'B Visa','4444',0,'x','credit card');
  insert into expense_categories (user_id,name) values (a,'Fuel');
  insert into expenses (id,user_id,vendor,category,amount,date) values ('exp1',a,'Loves','Fuel',20000,'2026-06-10');
  perform seed_chart_of_accounts(a); perform seed_chart_of_accounts(b);
  select id into chk from accounts where bank_account_id='bk1'; select id into sav from accounts where bank_account_id='bk2';
  select id into card from accounts where bank_account_id='bk3'; select id into b_chk from accounts where bank_account_id='bkb';
  select id into b_card from accounts where bank_account_id='bkbc';
  select id into ar from accounts where user_id=a and system_key='accounts_receivable';
  select id into fuel from accounts where user_id=a and name='Fuel';
  execute 'create function pg_temp.bal(p uuid) returns bigint language sql as $f$ select balance_cents from account_balances where account_id = p $f$';

  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform post_opening_balance(chk, 100000, '2026-06-01');

  -- ---- purchase on the card: expense recorded once, liability grows (inv 18) ----
  perform post_expense('exp1', card);
  if pg_temp.bal(card) = 20000 and pg_temp.bal(fuel) = 20000 and pg_temp.bal(chk) = 100000
  then results := results || 'PASS card purchase: Dr expense / Cr card liability; cash untouched'::text;
  else failures := failures || ('FAIL card purchase ' || pg_temp.bal(card) || '/' || pg_temp.bal(fuel) || '/' || pg_temp.bal(chk)); end if;

  -- ---- paying the card: Dr card liability / Cr bank; not an expense ----
  cp1 := record_card_payment('2026-06-20', 5000, chk, card, 'partial');
  if pg_temp.bal(card) = 15000 and pg_temp.bal(chk) = 95000 and pg_temp.bal(fuel) = 20000
     and (select source_type || ':' || source_id from journal_entries where source_id = cp1::text and reverses_entry_id is null) = 'transfer:' || cp1::text
     and (select kind from transfers where id = cp1) = 'card_payment'
  then results := results || 'PASS card payment: Dr card liability / Cr bank; expense not counted again; traceable'::text;
  else failures := failures || ('FAIL card payment ' || pg_temp.bal(card) || '/' || pg_temp.bal(chk) || '/' || pg_temp.bal(fuel)); end if;
  begin set constraints all immediate; results := results || 'PASS commit-time ledger checks run correctly as the signed-in role'::text;
  exception when others then failures := failures || ('FAIL commit-time checks as authenticated: ' || sqlstate || ' ' || sqlerrm); end;
  set constraints all deferred;
  cp2 := record_card_payment('2026-06-25', 15000, sav, card);
  select coalesce(sum(case when type = 'expense' then balance_cents end), 0) into v from account_balances where user_id = a;
  if pg_temp.bal(card) = 0 and pg_temp.bal(sav) = -15000 and v = 20000
  then results := results || 'PASS inv 18: purchase then payments in full: the card is paid off and the expense is counted exactly once'::text;
  else failures := failures || ('FAIL inv 18 ' || pg_temp.bal(card) || '/' || pg_temp.bal(sav) || '/' || v); end if;

  -- ---- overpayment leaves a credit on the card (allowed); edit; void ----
  cp3 := record_card_payment('2026-06-26', 3000, chk, card);
  if pg_temp.bal(card) = -3000 then results := results || 'PASS overpaying a card leaves a credit balance (no income, no expense)'::text; else failures := failures || ('FAIL overpay ' || pg_temp.bal(card)); end if;
  perform update_transfer(cp3, '2026-06-27', 1000, chk, card, 'fixed');
  if pg_temp.bal(card) = -1000 and pg_temp.bal(chk) = 94000
     and (select count(*) from journal_entry_trace where source_id = cp3::text) = 3
     and (select count(*) from journal_entry_trace where source_id = cp3::text and status = 'active') = 1
     and (select kind from transfers where id = cp3) = 'card_payment'
  then results := results || 'PASS edited card payment: reversal + repost, still a card payment'::text;
  else failures := failures || ('FAIL card payment edit ' || pg_temp.bal(card) || '/' || pg_temp.bal(chk)); end if;
  perform void_transfer(cp3);
  if pg_temp.bal(card) = 0 and pg_temp.bal(chk) = 95000 then results := results || 'PASS voided card payment: liability and bank restored'::text; else failures := failures || ('FAIL void card payment ' || pg_temp.bal(card)); end if;

  -- ---- rejected requests ----
  for t in select * from (values
    ('card payment to a bank account',        '23514', format('select record_card_payment(''2026-06-28'',100,%L,%L)', chk, sav)),
    ('card payment from the card itself',     '23514', format('select record_card_payment(''2026-06-28'',100,%L,%L)', card, card)),
    ('card payment from a card to a bank',    '23514', format('select record_card_payment(''2026-06-28'',100,%L,%L)', card, chk)),
    ('card payment to the A/R account',       '23514', format('select record_card_payment(''2026-06-28'',100,%L,%L)', chk, ar)),
    ('card payment to an expense account',    '23514', format('select record_card_payment(''2026-06-28'',100,%L,%L)', chk, fuel)),
    ('zero card payment',                     '23514', format('select record_card_payment(''2026-06-28'',0,%L,%L)', chk, card)),
    ('card payment without a date',           '23514', format('select record_card_payment(null,100,%L,%L)', chk, card)),
    ('card payment to another user''s card',  '23514', format('select record_card_payment(''2026-06-28'',100,%L,%L)', chk, b_card)),
    ('card payment to an unknown account',    '23514', format('select record_card_payment(''2026-06-28'',100,%L,gen_random_uuid())', chk)),
    ('editing a card payment to point at a bank account', '23514', format('select update_transfer(%L,''2026-06-27'',100,%L,%L)', cp1, chk, sav))
  ) as v(label, code, s)
  loop
    select count(*) into n from transfers;
    begin execute t.s; failures := failures || ('FAIL accepted: ' || t.label);
    exception when others then
      if sqlstate = t.code and (select count(*) from transfers) = n then results := results || ('PASS rejected: ' || t.label);
      else failures := failures || ('FAIL ' || t.label || ' -> ' || sqlstate || ' ' || sqlerrm); end if;
    end;
  end loop;

  -- ---- a card payment's entry cannot be reversed behind its back ----
  select id into e from journal_entry_trace where source_id = cp1::text and status = 'active';
  begin
    perform reverse_journal_entry(e);
    set constraints all immediate;
    failures := failures || 'FAIL card payment entry reversed behind its back';
  exception when others then
    if sqlstate = '23514' then results := results || 'PASS DB: a card payment''s ledger entry cannot be reversed without voiding it'::text;
    else failures := failures || ('FAIL direct reverse ' || sqlstate || ' ' || sqlerrm); end if;
  end;
  set constraints all deferred;

  -- ---- the database itself enforces what each kind of transfer may connect (privileged role) ----
  reset role;
  for t in select * from (values
    ('card_payment', 'bank', 'credit card',                 chk, sav),
    ('transfer',     'bank', 'another bank account',        chk, card),
    ('transfer',     'card', 'out of a bank account',       card, chk),
    ('card_payment', 'a/r',  'out of a bank account',       ar, card)
  ) as v(kind, label, expected, f, g)
  loop
    begin
      insert into transfers (id,user_id,kind,transfer_date,amount_cents,from_account_id,to_account_id)
        values ('f0000000-0000-4000-8000-000000000001', a, t.kind, '2026-06-01', 500, t.f, t.g);
      insert into journal_entries (id,user_id,entry_date,source_type,source_id)
        values ('f0000000-0000-4000-8000-0000000000e1', a, '2026-06-01', 'transfer', 'f0000000-0000-4000-8000-000000000001');
      insert into journal_lines (entry_id,user_id,account_id,debit_cents,credit_cents) values
        ('f0000000-0000-4000-8000-0000000000e1', a, t.g, 500, 0), ('f0000000-0000-4000-8000-0000000000e1', a, t.f, 0, 500);
      set constraints all immediate;
      failures := failures || ('FAIL accepted: ' || t.kind || ' from ' || t.label);
    exception when others then
      if sqlstate = '23514' and sqlerrm like '%' || t.expected || '%' then results := results || ('PASS DB rejects: ' || t.kind || ' that breaks the rule "' || t.expected || '"');
      else failures := failures || ('FAIL rule ' || t.kind || '/' || t.label || ' -> ' || sqlstate || ' ' || sqlerrm); end if;
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
    ('B voiding A''s card payment',  'P0002', format('select void_transfer(%L)', cp1)),
    ('B editing A''s card payment',  'P0002', format('select update_transfer(%L,''2026-06-01'',100,%L,%L)', cp1, b_chk, b_card)),
    ('B paying a card from A''s bank account', '23514', format('select record_card_payment(''2026-06-01'',100,%L,%L)', chk, b_card))
  ) as v(label, code, s)
  loop
    begin execute t.s; failures := failures || ('FAIL accepted: ' || t.label);
    exception when others then
      if sqlstate = t.code then results := results || ('PASS rejected: ' || t.label);
      else failures := failures || ('FAIL ' || t.label || ' -> ' || sqlstate || ' ' || sqlerrm); end if;
    end;
  end loop;
  select count(*) into n from transfers;
  if n = 0 then results := results || 'PASS B sees none of A''s card payments'::text; else failures := failures || 'FAIL B sees A transfers'; end if;
  reset role;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  begin perform record_card_payment('2026-06-01',100,chk,card); failures := failures || 'FAIL anon';
  exception when insufficient_privilege then results := results || 'PASS anon cannot execute record_card_payment'::text; end;
  reset role;

  begin set constraints all immediate; results := results || 'PASS all deferred checks hold for the full scenario'::text;
  exception when others then failures := failures || ('FAIL deferred ' || sqlerrm); end;

  if array_length(failures,1) is null then
    raise exception 'ROLLED BACK - ALL PASS (% checks): %', array_length(results,1), array_to_string(results,' | ');
  else
    raise exception 'ROLLED BACK - % FAILURES: % || PASSED: %', array_length(failures,1), array_to_string(failures,' | '), array_to_string(results,' | ');
  end if;
end
$test$;
