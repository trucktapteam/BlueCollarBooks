-- Stage B posting-function scenario tests: opening balances, expenses, edits (reversal + repost),
-- reversals, atomicity, tenant isolation of the functions, and the whole-ledger invariants (8, 9, 10).
-- Runs as real app roles via the public functions. One DO block, always rolls back.
-- Success = message starts 'ROLLED BACK - ALL PASS'.
do $test$
declare
  a uuid := '00000000-0000-4000-8000-0000000000aa';
  b uuid := '00000000-0000-4000-8000-0000000000bb';
  chk uuid; card uuid; b_chk uuid; fuel uuid; unc uuid; obe uuid; inc uuid;
  e1 uuid; e2 uuid; r uuid; n int; v bigint; v2 bigint;
  results text[] := '{}'; failures text[] := '{}';
  t record;
begin
  insert into auth.users (id,email,aud,role) values
    (a,'ta@example.invalid','authenticated','authenticated'),
    (b,'tb@example.invalid','authenticated','authenticated');
  insert into bank_accounts (id,user_id,name,last4,balance,last_updated,subtype) values
    ('bk-a1',a,'Checking','1111',0,'x',null), ('bk-a2',a,'Visa','2222',0,'x','credit card'), ('bk-b1',b,'B Checking','9999',0,'x',null);
  insert into expense_categories (user_id,name) values (a,'Fuel'),(a,'Meals');
  insert into expenses (id,user_id,vendor,category,amount,date,notes) values
    ('exp1',a,'Loves','Fuel',65000,'2026-06-09','Diesel'),
    ('exp2',a,'Mystery',null,1200,'2026-06-10',null),
    ('exp3',a,'Odd','NoSuchCategory',500,'2026-06-11',null),
    ('exp4',a,'Bad',null,0,'2026-06-12',null),
    ('exp6',a,'Unposted',null,300,'2026-06-13',null);

  -- ---- seeding ----
  perform seed_chart_of_accounts(a); perform seed_chart_of_accounts(b);
  select count(*) into n from accounts where user_id = a;
  perform seed_chart_of_accounts(a);
  select count(*) - n into v from accounts where user_id = a;
  if v = 0 then results := results || 'PASS seeding is idempotent'::text; else failures := failures || 'FAIL seeding added duplicates'; end if;
  select id into chk  from accounts where bank_account_id = 'bk-a1';
  select id into card from accounts where bank_account_id = 'bk-a2';
  select id into b_chk from accounts where bank_account_id = 'bk-b1';
  select id into fuel from accounts where user_id = a and name = 'Fuel' and type = 'expense';
  select id into unc  from accounts where user_id = a and system_key = 'uncategorized_expense';
  select id into obe  from accounts where user_id = a and system_key = 'opening_balance_equity';
  select id into inc  from accounts where user_id = a and system_key = 'income';
  if (select type from accounts where id = chk) = 'asset' and (select type from accounts where id = card) = 'liability'
     and fuel is not null and exists (select 1 from accounts where user_id = a and name = 'Meals' and type = 'expense')
     and (select count(*) from accounts where user_id = a and system_key is not null) = 8
  then results := results || 'PASS seeding: bank->asset, credit card->liability, categories->expense accounts, 10 system accounts'::text;
  else failures := failures || 'FAIL seeding shape'; end if;

  execute 'create function pg_temp.bal(p uuid) returns bigint language sql as $f$ select balance_cents from account_balances where account_id = p $f$';

  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- ---- opening balances ----
  perform post_opening_balance(chk, 500000, '2026-06-01');
  if pg_temp.bal(chk) = 500000 and pg_temp.bal(obe) = 500000 then results := results || 'PASS asset opening balance: Dr account / Cr Opening Balance Equity'::text;
  else failures := failures || ('FAIL asset opening balance ' || pg_temp.bal(chk) || '/' || pg_temp.bal(obe)); end if;
  perform post_opening_balance(card, 20000, '2026-06-01');
  if pg_temp.bal(card) = 20000 and pg_temp.bal(obe) = 480000 then results := results || 'PASS liability opening balance: Cr card / Dr Opening Balance Equity'::text;
  else failures := failures || ('FAIL liability opening ' || pg_temp.bal(card) || '/' || pg_temp.bal(obe)); end if;

  for t in select * from (values
    ('duplicate opening balance',      '23505', format('select post_opening_balance(%L, 100, ''2026-06-02'')', chk)),
    ('zero opening balance',           '23514', format('select post_opening_balance(%L, 0, ''2026-06-02'')', fuel)),
    ('opening balance on expense acct','23514', format('select post_opening_balance(%L, 100, ''2026-06-02'')', fuel)),
    ('opening balance on other user''s account','P0002', format('select post_opening_balance(%L, 100, ''2026-06-02'')', b_chk))
  ) as v(label, code, s)
  loop
    begin execute t.s; failures := failures || ('FAIL accepted: ' || t.label);
    exception when others then
      if sqlstate = t.code then results := results || ('PASS rejected: ' || t.label);
      else failures := failures || ('FAIL ' || t.label || ' -> ' || sqlstate || ' ' || sqlerrm); end if;
    end;
  end loop;

  -- ---- expenses ----
  e1 := post_expense('exp1', chk);
  if pg_temp.bal(fuel) = 65000 and pg_temp.bal(chk) = 435000 then results := results || 'PASS expense: Dr expense account / Cr bank'::text;
  else failures := failures || ('FAIL expense posting ' || pg_temp.bal(fuel) || '/' || pg_temp.bal(chk)); end if;
  begin set constraints all immediate; results := results || 'PASS commit-time ledger checks run correctly as the signed-in role'::text;
  exception when others then failures := failures || ('FAIL commit-time checks as authenticated: ' || sqlstate || ' ' || sqlerrm); end;
  set constraints all deferred;
  perform post_expense('exp2', chk);
  perform post_expense('exp3', chk);
  if pg_temp.bal(unc) = 1700 then results := results || 'PASS expenses with no/unknown category go to Uncategorized Expense'::text;
  else failures := failures || ('FAIL uncategorized ' || pg_temp.bal(unc)); end if;

  for t in select * from (values
    ('posting the same expense twice',      '23505', format('select post_expense(''exp1'', %L)', chk)),
    ('expense with zero amount',            '23514', format('select post_expense(''exp4'', %L)', chk)),
    ('expense paid from an expense account','23514', format('select post_expense(''exp6'', %L)', fuel)),
    ('expense paid from another user''s account','23514', format('select post_expense(''exp6'', %L)', b_chk)),
    ('expense that does not exist',         'P0002', format('select post_expense(''nope'', %L)', chk))
  ) as v(label, code, s)
  loop
    begin execute t.s; failures := failures || ('FAIL accepted: ' || t.label);
    exception when others then
      if sqlstate = t.code then results := results || ('PASS rejected: ' || t.label);
      else failures := failures || ('FAIL ' || t.label || ' -> ' || sqlstate || ' ' || sqlerrm); end if;
    end;
  end loop;

  -- credit-card expense raises the liability; only one expense counted
  insert into expenses (id,user_id,vendor,category,amount,date) values ('exp5',a,'Diner','Meals',1000,'2026-06-12');
  perform post_expense('exp5', card);
  if pg_temp.bal(card) = 21000 then results := results || 'PASS card-paid expense increases Credit Card liability'::text;
  else failures := failures || ('FAIL card expense ' || pg_temp.bal(card)); end if;

  -- ---- edit = reversal + repost ----
  update expenses set amount = 70000 where id = 'exp1';
  e2 := repost_expense('exp1');
  if pg_temp.bal(fuel) = 70000 and pg_temp.bal(chk) = 428300
  then results := results || 'PASS edited expense: old amount fully replaced, same bank account kept'::text;
  else failures := failures || ('FAIL repost balances ' || pg_temp.bal(fuel) || '/' || pg_temp.bal(chk)); end if;
  select count(*) into n from journal_entry_trace where source_type = 'expense' and source_id = 'exp1';
  if n = 3 and (select count(*) from journal_entry_trace where source_id='exp1' and status='reversed') = 1
     and (select count(*) from journal_entry_trace where source_id='exp1' and status='reversal') = 1
     and (select count(*) from journal_entry_trace where source_id='exp1' and status='active') = 1
  then results := results || 'PASS audit trail keeps original, reversal and replacement (3 entries, 1 active)'::text;
  else failures := failures || ('FAIL trace rows ' || n); end if;
  -- reposting to move the expense to the credit card
  perform repost_expense('exp1', card);
  if pg_temp.bal(card) = 21000 + 70000 and pg_temp.bal(fuel) = 70000 then results := results || 'PASS repost can change the paid-from account'::text;
  else failures := failures || ('FAIL repost to card ' || pg_temp.bal(card)); end if;

  -- atomicity: a failing repost must not leave a dangling reversal
  select count(*) into n from journal_entries where user_id = a;
  update expenses set amount = 0 where id = 'exp1';
  begin perform repost_expense('exp1'); failures := failures || 'FAIL repost of zero-amount expense accepted';
  exception when others then
    select count(*) into v from journal_entries where user_id = a;
    if sqlstate = '23514' and v = n and pg_temp.bal(fuel) = 70000 then results := results || 'PASS failed repost is atomic (no half-reversal left behind)'::text;
    else failures := failures || ('FAIL atomicity ' || sqlstate || ' entries ' || n || '->' || v); end if;
  end;
  update expenses set amount = 70000 where id = 'exp1';

  -- ---- reversals ----
  r := reverse_active_entry('expense', 'exp2', 'Deleted expense');
  if r is not null and pg_temp.bal(unc) = 500 and (select count(*) from journal_entry_trace where source_id='exp2' and status='active') = 0
  then results := results || 'PASS reverse_active_entry removes an expense''s effect'::text;
  else failures := failures || ('FAIL reverse_active_entry ' || pg_temp.bal(unc)); end if;
  if reverse_active_entry('expense', 'exp2') is null then results := results || 'PASS reversing a source with nothing active is a no-op'::text;
  else failures := failures || 'FAIL second reverse not null'; end if;
  begin perform reverse_journal_entry(r); failures := failures || 'FAIL reversed a reversal';
  exception when others then if sqlstate = '23514' then results := results || 'PASS a reversal cannot be reversed'::text; else failures := failures || ('FAIL rev-of-rev ' || sqlstate); end if; end;
  begin perform reverse_journal_entry(e1); failures := failures || 'FAIL double reversal';
  exception when others then if sqlstate = '23505' then results := results || 'PASS an already-reversed entry cannot be reversed again'::text; else failures := failures || ('FAIL double rev ' || sqlstate); end if; end;
  -- re-post after delete-reversal is allowed (replacement)
  perform post_expense('exp2', chk);
  if pg_temp.bal(unc) = 1700 then results := results || 'PASS re-posting a reversed source is allowed'::text; else failures := failures || 'FAIL repost after reverse'; end if;

  -- ---- whole-ledger invariants (8, 9, 10) ----
  reset role;
  select sum(debit_total), sum(credit_total) into v, v2 from account_balances where user_id = a;
  if v = v2 and v > 0 then results := results || 'PASS inv 8: total debits = total credits'::text; else failures := failures || ('FAIL inv 8 ' || v || '/' || v2); end if;
  select
    coalesce(sum(balance_cents) filter (where type='asset'),0) - coalesce(sum(balance_cents) filter (where type='liability'),0),
    coalesce(sum(balance_cents) filter (where type='equity'),0) + coalesce(sum(balance_cents) filter (where type='income'),0) - coalesce(sum(balance_cents) filter (where type='expense'),0)
  into v, v2 from account_balances where user_id = a;
  if v = v2 then results := results || 'PASS inv 9/10: assets - liabilities = equity + (income - expenses)'::text; else failures := failures || ('FAIL inv 9 ' || v || '/' || v2); end if;
  select sum(balance_cents) into v from account_balances where user_id = a and type = 'income';
  if coalesce(v,0) = 0 then results := results || 'PASS expenses/opening balances created no income'::text; else failures := failures || 'FAIL income appeared'; end if;
  select count(*) into n from account_balances where user_id = b and (debit_total <> 0 or credit_total <> 0);
  if n = 0 then results := results || 'PASS user B ledger untouched'::text; else failures := failures || 'FAIL B ledger has activity'; end if;
  -- traceability: every expense entry points at a real expense row of the same user
  select count(*) into n from journal_entries j where j.user_id = a and j.source_type = 'expense'
     and not exists (select 1 from expenses x where x.id = j.source_id and x.user_id = j.user_id);
  if n = 0 then results := results || 'PASS traceability: every expense entry resolves to its expense'::text; else failures := failures || 'FAIL orphan source ref'; end if;

  -- ---- other users / roles ----
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  for t in select * from (values
    ('B posting A''s expense',        'P0002', format('select post_expense(''exp4'', %L)', b_chk)),
    ('B reversing A''s entry',        'P0002', format('select reverse_journal_entry(%L)', e1)),
    ('B reposting A''s expense',      'P0002', format('select repost_expense(''exp1'', %L)', b_chk))
  ) as v(label, code, s)
  loop
    begin execute t.s; failures := failures || ('FAIL accepted: ' || t.label);
    exception when others then
      if sqlstate = t.code then results := results || ('PASS rejected: ' || t.label);
      else failures := failures || ('FAIL ' || t.label || ' -> ' || sqlstate || ' ' || sqlerrm); end if;
    end;
  end loop;
  select count(*) into n from journal_entries; select n + count(*) into n from journal_lines;
  if n = 0 then results := results || 'PASS B sees none of A''s ledger'::text; else failures := failures || 'FAIL B sees A ledger rows'; end if;
  reset role;

  perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);   -- no subject = not signed in
  set local role authenticated;
  begin perform post_expense('exp1', chk); failures := failures || 'FAIL unauthenticated post';
  exception when others then if sqlstate = '28000' then results := results || 'PASS function refuses when not signed in'::text; else failures := failures || ('FAIL no-auth ' || sqlstate); end if; end;
  reset role;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  begin perform post_expense('exp1', chk); failures := failures || 'FAIL anon executed posting';
  exception when insufficient_privilege then results := results || 'PASS anon cannot execute posting functions'::text; end;
  reset role;

  -- ---- everything posted validates at commit time too ----
  begin
    set constraints all immediate;
    results := results || 'PASS all deferred ledger checks hold for the full scenario'::text;
  exception when others then failures := failures || ('FAIL deferred checks: ' || sqlerrm);
  end;

  if array_length(failures,1) is null then
    raise exception 'ROLLED BACK - ALL PASS (% checks): %', array_length(results,1), array_to_string(results,' | ');
  else
    raise exception 'ROLLED BACK - % FAILURES: % || PASSED: %', array_length(failures,1), array_to_string(failures,' | '), array_to_string(results,' | ');
  end if;
end
$test$;
