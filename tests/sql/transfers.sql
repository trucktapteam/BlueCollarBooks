-- Stage D1 tests: transfers between own accounts (inv 14), DB-enforced consistency, event-entry guard, ownership.
-- One DO block, always rolls back. Success = message starts 'ROLLED BACK - ALL PASS'.
do $test$
declare
  a uuid := '00000000-0000-4000-8000-0000000000aa';
  b uuid := '00000000-0000-4000-8000-0000000000bb';
  c uuid := '00000000-0000-4000-8000-0000000000cc';
  chk uuid; sav uuid; card uuid; b_chk uuid; c_chk uuid; c_sav uuid; ar uuid; fuel uuid;
  t1 uuid; t2 uuid; p1 uuid; e uuid; n int; v bigint; v2 bigint; t record;
  results text[] := '{}'; failures text[] := '{}';
begin
  insert into auth.users (id,email,aud,role) values
    (a,'ta@example.invalid','authenticated','authenticated'),(b,'tb@example.invalid','authenticated','authenticated'),(c,'tc@example.invalid','authenticated','authenticated');
  insert into bank_accounts (id,user_id,name,last4,balance,last_updated,subtype) values
    ('bk1',a,'Checking','1111',0,'x',null),('bk2',a,'Savings','2222',0,'x',null),('bk3',a,'Visa','3333',0,'x','credit card'),
    ('bkb',b,'B Checking','9999',0,'x',null),('bkc1',c,'C Checking','8888',0,'x',null),('bkc2',c,'C Savings','7777',0,'x',null);
  insert into expense_categories (user_id,name) values (a,'Fuel');
  insert into customers (id,user_id,name) values ('c1',a,'ACME');
  perform seed_chart_of_accounts(a); perform seed_chart_of_accounts(b); perform seed_chart_of_accounts(c);
  select id into chk from accounts where bank_account_id='bk1'; select id into sav from accounts where bank_account_id='bk2';
  select id into card from accounts where bank_account_id='bk3'; select id into b_chk from accounts where bank_account_id='bkb';
  select id into c_chk from accounts where bank_account_id='bkc1'; select id into c_sav from accounts where bank_account_id='bkc2';
  select id into ar from accounts where user_id=a and system_key='accounts_receivable';
  select id into fuel from accounts where user_id=a and name='Fuel';
  execute 'create function pg_temp.bal(p uuid) returns bigint language sql as $f$ select balance_cents from account_balances where account_id = p $f$';

  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform post_opening_balance(chk, 100000, '2026-06-01');

  -- ---- a transfer: Dr destination / Cr source, no P&L effect (inv 14) ----
  t1 := record_transfer('2026-06-10', 30000, chk, sav, 'move cash');
  if pg_temp.bal(chk) = 70000 and pg_temp.bal(sav) = 30000
     and (select source_type || ':' || source_id from journal_entries where source_id = t1::text and reverses_entry_id is null) = 'transfer:' || t1::text
  then results := results || 'PASS transfer: Dr destination / Cr source; traceable to the transfer'::text;
  else failures := failures || ('FAIL transfer posting ' || pg_temp.bal(chk) || '/' || pg_temp.bal(sav)); end if;
  -- the real commit path: deferred ledger checks fire as the signed-in role, not as the owner
  begin set constraints all immediate; results := results || 'PASS commit-time ledger checks run correctly as the signed-in role'::text;
  exception when others then failures := failures || ('FAIL commit-time checks as authenticated: ' || sqlstate || ' ' || sqlerrm); end;
  set constraints all deferred;
  select coalesce(sum(balance_cents),0) into v from account_balances where user_id = a and type in ('income','expense');
  select coalesce(sum(balance_cents) filter (where type='asset'),0) into v2 from account_balances where user_id = a;
  if v = 0 and v2 = 100000 then results := results || 'PASS inv 14: transfer has zero P&L effect and total cash is unchanged'::text;
  else failures := failures || ('FAIL inv 14 ' || v || '/' || v2); end if;

  -- ---- rejected requests ----
  for t in select * from (values
    ('same account on both sides',         '23514', format('select record_transfer(''2026-06-11'',100,%L,%L)', chk, chk)),
    ('zero amount',                        '23514', format('select record_transfer(''2026-06-11'',0,%L,%L)', chk, sav)),
    ('no date',                            '23514', format('select record_transfer(null,100,%L,%L)', chk, sav)),
    ('from the A/R account',               '23514', format('select record_transfer(''2026-06-11'',100,%L,%L)', ar, sav)),
    ('to an expense account',              '23514', format('select record_transfer(''2026-06-11'',100,%L,%L)', chk, fuel)),
    ('to a credit card (use a card payment)','23514', format('select record_transfer(''2026-06-11'',100,%L,%L)', chk, card)),
    ('from a credit card',                 '23514', format('select record_transfer(''2026-06-11'',100,%L,%L)', card, sav)),
    ('to another user''s account',         '23514', format('select record_transfer(''2026-06-11'',100,%L,%L)', chk, b_chk)),
    ('to an unknown account',              '23514', format('select record_transfer(''2026-06-11'',100,%L,gen_random_uuid())', chk))
  ) as v(label, code, s)
  loop
    select count(*) into n from transfers;
    begin execute t.s; failures := failures || ('FAIL accepted: ' || t.label);
    exception when others then
      if sqlstate = t.code and (select count(*) from transfers) = n then results := results || ('PASS rejected: ' || t.label);
      else failures := failures || ('FAIL ' || t.label || ' -> ' || sqlstate || ' ' || sqlerrm); end if;
    end;
  end loop;

  -- ---- edit = reversal + repost ----
  perform update_transfer(t1, '2026-06-12', 25000, chk, sav, 'edited');
  if pg_temp.bal(chk) = 75000 and pg_temp.bal(sav) = 25000
     and (select count(*) from journal_entry_trace where source_id = t1::text) = 3
     and (select count(*) from journal_entry_trace where source_id = t1::text and status = 'active') = 1
     and (select entry_date from journal_entry_trace where source_id = t1::text and status = 'active') = date '2026-06-12'
  then results := results || 'PASS edited transfer: old entry reversed, replacement posted (3 entries, 1 active)'::text;
  else failures := failures || ('FAIL update ' || pg_temp.bal(chk) || '/' || pg_temp.bal(sav)); end if;
  -- reverse direction
  perform update_transfer(t1, '2026-06-12', 25000, sav, chk, null);
  if pg_temp.bal(chk) = 125000 and pg_temp.bal(sav) = -25000 then results := results || 'PASS editing the direction reposts correctly (balances are not blocked from going negative)'::text;
  else failures := failures || ('FAIL direction ' || pg_temp.bal(chk) || '/' || pg_temp.bal(sav)); end if;
  perform update_transfer(t1, '2026-06-12', 25000, chk, sav, null);

  -- ---- void ----
  t2 := record_transfer('2026-06-13', 5000, chk, sav);
  perform void_transfer(t2);
  if pg_temp.bal(chk) = 75000 and pg_temp.bal(sav) = 25000 and (select voided_at is not null from transfers where id = t2)
     and not exists (select 1 from journal_entry_trace where source_id = t2::text and status = 'active')
  then results := results || 'PASS void: entry reversed, row kept for history'::text; else failures := failures || 'FAIL void'; end if;
  perform void_transfer(t2);
  results := results || 'PASS voiding twice is a no-op'::text;
  begin perform update_transfer(t2, '2026-06-14', 100, chk, sav); failures := failures || 'FAIL edited a voided transfer';
  exception when others then if sqlstate = '23514' then results := results || 'PASS a voided transfer cannot be edited'::text; else failures := failures || ('FAIL voided edit ' || sqlstate); end if; end;

  -- ---- direct reversal of an event entry (bypassing the transfer/payment row) is rejected at commit ----
  select id into e from journal_entry_trace where source_id = t1::text and status = 'active';
  begin
    perform reverse_journal_entry(e);
    set constraints all immediate;
    failures := failures || 'FAIL transfer entry reversed behind the transfer''s back';
  exception when others then
    if sqlstate = '23514' then results := results || 'PASS DB: a transfer''s ledger entry cannot be reversed without voiding the transfer'::text;
    else failures := failures || ('FAIL direct reverse ' || sqlstate || ' ' || sqlerrm); end if;
  end;
  set constraints all deferred;
  p1 := record_payment('c1', '2026-06-15', 1000, chk, '[]');
  select id into e from journal_entry_trace where source_id = p1::text and status = 'active';
  begin
    perform reverse_journal_entry(e);
    set constraints all immediate;
    failures := failures || 'FAIL payment entry reversed behind the payment''s back';
  exception when others then
    if sqlstate = '23514' then results := results || 'PASS DB: a payment''s ledger entry cannot be reversed without voiding the payment'::text;
    else failures := failures || ('FAIL direct reverse payment ' || sqlstate || ' ' || sqlerrm); end if;
  end;
  set constraints all deferred;

  -- ---- database-level consistency (privileged role: only triggers/constraints stand in the way) ----
  reset role;
  for t in select * from (values
    ('transfer amount changed without reposting',  '23514', format('update transfers set amount_cents = 31000 where id = %L', t1)),
    ('transfer accounts changed without reposting','23514', format('update transfers set from_account_id = %L, to_account_id = %L where id = %L', sav, chk, t1)),
    ('transfer date changed without reposting',    '23514', format('update transfers set transfer_date = ''2026-07-01'' where id = %L', t1)),
    ('transfer voided without reversing the ledger','23514', format('update transfers set voided_at = now() where id = %L', t1)),
    ('transfer inserted without a ledger entry',   '23514', format('insert into transfers (user_id,kind,transfer_date,amount_cents,from_account_id,to_account_id) values (%L,''transfer'',''2026-06-01'',500,%L,%L)', a, chk, sav)),
    ('transfer to the same account',               '23514', format('insert into transfers (user_id,kind,transfer_date,amount_cents,from_account_id,to_account_id) values (%L,''transfer'',''2026-06-01'',500,%L,%L)', a, chk, chk)),
    ('transfer across users (account of another user)','23503', format('insert into transfers (user_id,kind,transfer_date,amount_cents,from_account_id,to_account_id) values (%L,''transfer'',''2026-06-01'',500,%L,%L)', a, chk, b_chk)),
    ('transfer with negative amount',              '23514', format('insert into transfers (user_id,kind,transfer_date,amount_cents,from_account_id,to_account_id) values (%L,''transfer'',''2026-06-01'',-5,%L,%L)', a, chk, sav)),
    ('transfer with an unknown kind',              '23514', format('insert into transfers (user_id,kind,transfer_date,amount_cents,from_account_id,to_account_id) values (%L,''gift'',''2026-06-01'',5,%L,%L)', a, chk, sav)),
    ('delete a live (posted) transfer',            '23503', format('delete from transfers where id = %L', t1))
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

  -- ---- other users and roles ----
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  for t in select * from (values
    ('B updating A''s transfer', 'P0002', format('select update_transfer(%L,''2026-06-01'',100,%L,%L)', t1, b_chk, b_chk)),
    ('B voiding A''s transfer',  'P0002', format('select void_transfer(%L)', t1)),
    ('B transferring from A''s account', '23514', format('select record_transfer(''2026-06-01'',100,%L,%L)', chk, b_chk)),
    ('authenticated INSERT transfers', '42501', format('insert into transfers (user_id,kind,transfer_date,amount_cents,from_account_id,to_account_id) values (auth.uid(),''transfer'',''2026-06-01'',1,%L,%L)', b_chk, b_chk)),
    ('authenticated UPDATE transfers', '42501', 'update transfers set amount_cents = 1'),
    ('authenticated DELETE transfers', '42501', 'delete from transfers')
  ) as v(label, code, s)
  loop
    begin execute t.s; failures := failures || ('FAIL accepted: ' || t.label);
    exception when others then
      if sqlstate = t.code then results := results || ('PASS rejected: ' || t.label);
      else failures := failures || ('FAIL ' || t.label || ' -> ' || sqlstate || ' ' || sqlerrm); end if;
    end;
  end loop;
  select count(*) into n from transfers;
  if n = 0 then results := results || 'PASS B sees none of A''s transfers'::text; else failures := failures || 'FAIL B sees A transfers'; end if;
  reset role;

  perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  set local role authenticated;
  begin perform record_transfer('2026-06-01',100,chk,sav); failures := failures || 'FAIL unauth';
  exception when others then if sqlstate = '28000' then results := results || 'PASS not signed in is refused'::text; else failures := failures || ('FAIL unauth ' || sqlstate); end if; end;
  reset role;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  begin perform record_transfer('2026-06-01',100,chk,sav); failures := failures || 'FAIL anon';
  exception when insufficient_privilege then results := results || 'PASS anon cannot execute record_transfer'::text; end;
  begin perform 1 from transfers; failures := failures || 'FAIL anon read transfers';
  exception when insufficient_privilege then results := results || 'PASS anon cannot read transfers'::text; end;
  reset role;

  -- ---- deleting a user cascades through transfers and the immutable ledger ----
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform post_opening_balance(c_chk, 5000, '2026-06-01');
  perform record_transfer('2026-06-02', 1000, c_chk, c_sav);
  reset role;
  begin
    set constraints all immediate; set constraints all deferred;
    delete from auth.users where id = c;
    select count(*) into n from transfers where user_id = c; select n + count(*) into n from journal_entries where user_id = c;
    if n = 0 then results := results || 'PASS deleting a user removes their transfers and ledger'::text; else failures := failures || 'FAIL user delete left rows'; end if;
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
