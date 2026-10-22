-- Stage C3 tests: payments, applications, posting, DB-enforced invariant 7, ownership.
-- One DO block, always rolls back. Success = message starts 'ROLLED BACK - ALL PASS'.
do $test$
declare
  a uuid := '00000000-0000-4000-8000-0000000000aa';
  b uuid := '00000000-0000-4000-8000-0000000000bb';
  c uuid := '00000000-0000-4000-8000-0000000000cc';
  chk uuid; chk2 uuid; ar uuid; inc uuid; fuel uuid; b_chk uuid; c_chk uuid;
  p1 uuid; p2 uuid; p3 uuid; p4 uuid; n int; v bigint; v2 bigint; t record;
  results text[] := '{}'; failures text[] := '{}';
begin
  insert into auth.users (id,email,aud,role) values
    (a,'ta@example.invalid','authenticated','authenticated'),(b,'tb@example.invalid','authenticated','authenticated'),(c,'tc@example.invalid','authenticated','authenticated');
  insert into customers (id,user_id,name) values ('c1',a,'ACME'),('c2',a,'Other Co');
  insert into bank_accounts (id,user_id,name,last4,balance,last_updated) values ('bk1',a,'Checking','1111',0,'x'),('bk2',a,'Savings','2222',0,'x'),('bkb',b,'B Checking','9999',0,'x'),('bkc',c,'C Checking','8888',0,'x');
  insert into expense_categories (user_id,name) values (a,'Fuel');
  perform seed_chart_of_accounts(a); perform seed_chart_of_accounts(b); perform seed_chart_of_accounts(c);
  select id into chk from accounts where bank_account_id='bk1';  select id into chk2 from accounts where bank_account_id='bk2';
  select id into b_chk from accounts where bank_account_id='bkb'; select id into c_chk from accounts where bank_account_id='bkc';
  select id into ar from accounts where user_id=a and system_key='accounts_receivable';
  select id into inc from accounts where user_id=a and system_key='income';
  select id into fuel from accounts where user_id=a and name='Fuel';
  execute 'create function pg_temp.bal(p uuid) returns bigint language sql as $f$ select balance_cents from account_balances where account_id = p $f$';

  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform save_invoice('{"id":"inv-1","invoice_number":"1001","customer":"ACME","customer_id":"c1","amount":50000,"status":"Sent","invoice_date":"2026-06-01"}', '[]');
  perform save_invoice('{"id":"inv-2","invoice_number":"1002","customer":"ACME","customer_id":"c1","amount":30000,"status":"Sent","invoice_date":"2026-06-02"}', '[]');
  perform save_invoice('{"id":"inv-3","invoice_number":"1003","customer":"ACME","customer_id":"c1","amount":20000,"status":"Draft","invoice_date":"2026-06-03"}', '[]');
  perform save_invoice('{"id":"inv-4","invoice_number":"1004","customer":"Other Co","customer_id":"c2","amount":10000,"status":"Sent","invoice_date":"2026-06-04"}', '[]');
  perform sync_invoice_posting('inv-1'); perform sync_invoice_posting('inv-2'); perform sync_invoice_posting('inv-3'); perform sync_invoice_posting('inv-4');
  if pg_temp.bal(ar) = 90000 and pg_temp.bal(inc) = 90000 then results := results || 'PASS setup: 3 sent invoices post A/R and Income of 90000; draft posts nothing'::text;
  else failures := failures || ('FAIL setup ' || pg_temp.bal(ar)); end if;

  -- ---- a payment: Dr bank / Cr A/R, no second income (inv 11) ----
  p1 := record_payment('c1', '2026-06-10', 40000, chk, '[{"invoice_id":"inv-1","amount_cents":40000}]', 'check', '#101', null);
  if pg_temp.bal(chk) = 40000 and pg_temp.bal(ar) = 50000 and pg_temp.bal(inc) = 90000
     and (select source_type || ':' || source_id from journal_entries where source_id = p1::text and reverses_entry_id is null) = 'payment:' || p1::text
  then results := results || 'PASS payment: Dr bank / Cr A/R; Income unchanged (no second revenue); traceable to the payment'::text;
  else failures := failures || ('FAIL payment posting ' || pg_temp.bal(chk) || '/' || pg_temp.bal(ar) || '/' || pg_temp.bal(inc)); end if;
  p2 := record_payment('c1', '2026-06-12', 10000, chk, '[{"invoice_id":"inv-1","amount_cents":10000}]');
  if (select sum(amount_cents) from payment_applications where invoice_id='inv-1') = 50000 and pg_temp.bal(ar) = 40000
  then results := results || 'PASS two payments fully apply an invoice'::text; else failures := failures || 'FAIL two payments'; end if;
  p3 := record_payment('c1', '2026-06-13', 5000, chk2, '[]');
  if pg_temp.bal(chk2) = 5000 and pg_temp.bal(ar) = 35000 and not exists (select 1 from payment_applications where payment_id = p3)
  then results := results || 'PASS unapplied payment is allowed (customer credit stays in A/R, nothing guessed)'::text; else failures := failures || 'FAIL unapplied'; end if;

  -- ---- rejected requests (friendly checks) ----
  for t in select * from (values
    ('over-apply an invoice',               '23514', format('select record_payment(''c1'',''2026-06-14'',99999,%L,''[{"invoice_id":"inv-2","amount_cents":35000}]'')', chk)),
    ('over-apply the payment itself',       '23514', format('select record_payment(''c1'',''2026-06-14'',1000,%L,''[{"invoice_id":"inv-2","amount_cents":2000}]'')', chk)),
    ('apply to an invoice already fully paid','23514', format('select record_payment(''c1'',''2026-06-14'',100,%L,''[{"invoice_id":"inv-1","amount_cents":100}]'')', chk)),
    ('apply to a draft (unposted) invoice', '23514', format('select record_payment(''c1'',''2026-06-14'',100,%L,''[{"invoice_id":"inv-3","amount_cents":100}]'')', chk)),
    ('apply to another customer''s invoice','23514', format('select record_payment(''c1'',''2026-06-14'',100,%L,''[{"invoice_id":"inv-4","amount_cents":100}]'')', chk)),
    ('same invoice twice in one payment',   '23505', format('select record_payment(''c1'',''2026-06-14'',500,%L,''[{"invoice_id":"inv-2","amount_cents":100},{"invoice_id":"inv-2","amount_cents":100}]'')', chk)),
    ('zero-dollar payment',                 '23514', format('select record_payment(''c1'',''2026-06-14'',0,%L,''[]'')', chk)),
    ('payment without a date',              '23514', format('select record_payment(''c1'',null,100,%L,''[]'')', chk)),
    ('deposit to the A/R account',          '23514', format('select record_payment(''c1'',''2026-06-14'',100,%L,''[]'')', ar)),
    ('deposit to an expense account',       '23514', format('select record_payment(''c1'',''2026-06-14'',100,%L,''[]'')', fuel)),
    ('deposit to another user''s account',  '23514', format('select record_payment(''c1'',''2026-06-14'',100,%L,''[]'')', b_chk)),
    ('unknown customer',                    'P0002', format('select record_payment(''nope'',''2026-06-14'',100,%L,''[]'')', chk)),
    ('unknown invoice',                     'P0002', format('select record_payment(''c1'',''2026-06-14'',100,%L,''[{"invoice_id":"zzz","amount_cents":100}]'')', chk))
  ) as v(label, code, s)
  loop
    select count(*) into n from payments;
    begin execute t.s; failures := failures || ('FAIL accepted: ' || t.label);
    exception when others then
      if sqlstate = t.code and (select count(*) from payments) = n then results := results || ('PASS rejected: ' || t.label);
      else failures := failures || ('FAIL ' || t.label || ' -> ' || sqlstate || ' ' || sqlerrm); end if;
    end;
  end loop;

  -- ---- edit = reversal + repost, applications replaced ----
  perform update_payment(p1, 'c1', '2026-06-11', 30000, chk2, '[{"invoice_id":"inv-1","amount_cents":30000}]', 'check', '#101', 'edited');
  if pg_temp.bal(chk) = 10000 and pg_temp.bal(chk2) = 35000 and pg_temp.bal(ar) = 45000
     and (select count(*) from journal_entry_trace where source_id = p1::text) = 3
     and (select count(*) from journal_entry_trace where source_id = p1::text and status = 'active') = 1
     and (select sum(amount_cents) from payment_applications where payment_id = p1) = 30000
  then results := results || 'PASS edited payment: new amount/date/account, old entry reversed, applications replaced'::text;
  else failures := failures || ('FAIL update ' || pg_temp.bal(chk) || '/' || pg_temp.bal(chk2) || '/' || pg_temp.bal(ar)); end if;

  -- ---- void ----
  perform void_payment(p3);
  if pg_temp.bal(chk2) = 30000 and pg_temp.bal(ar) = 50000 and (select voided_at is not null from payments where id = p3)
     and not exists (select 1 from journal_entry_trace where source_id = p3::text and status = 'active')
  then results := results || 'PASS void: ledger entry reversed, payment kept for history'::text; else failures := failures || ('FAIL void ' || pg_temp.bal(chk2)); end if;
  perform void_payment(p3);
  results := results || 'PASS voiding twice is a no-op'::text;
  begin perform update_payment(p3, 'c1', '2026-06-15', 100, chk, '[]'); failures := failures || 'FAIL edited voided payment';
  exception when others then if sqlstate = '23514' then results := results || 'PASS a voided payment cannot be edited'::text; else failures := failures || ('FAIL voided edit ' || sqlstate); end if; end;
  perform void_payment(p2);   -- reopens 10000 on inv-1
  if (select sum(amount_cents) from payment_applications where invoice_id='inv-1') = 30000 then results := results || 'PASS voiding an applied payment reopens the invoice balance'::text; else failures := failures || 'FAIL reopen'; end if;

  -- a large unapplied payment used by the DB-level checks below
  declare p5 uuid; app_total bigint;
  begin
    p5 := record_payment('c1', '2026-06-20', 100000, chk, '[]');

    -- un-posting an invoice that has payments applied is rejected by the database
    begin
      perform save_invoice('{"id":"inv-1","invoice_number":"1001","customer":"ACME","customer_id":"c1","amount":50000,"status":"Draft","invoice_date":"2026-06-01"}', '[]');
      perform sync_invoice_posting('inv-1');
      set constraints all immediate;
      failures := failures || 'FAIL un-posted an invoice that has payments applied';
    exception when others then
      if sqlstate = '23514' then results := results || 'PASS DB: an invoice with payments applied cannot be un-posted'::text; else failures := failures || ('FAIL unpost ' || sqlstate || ' ' || sqlerrm); end if;
    end;
    set constraints all deferred;

    reset role;
    for t in select * from (values
      ('inv 7: application larger than the invoice',  '23514', format('insert into payment_applications (user_id,payment_id,invoice_id,amount_cents) values (%L,%L,''inv-2'',35000)', a, p5)),
      ('inv 7: applications larger than the payment', '23514', format('insert into payment_applications (user_id,payment_id,invoice_id,amount_cents) values (%L,%L,''inv-2'',1000)', a, p1)),
      ('application across customers',                '23514', format('insert into payment_applications (user_id,payment_id,invoice_id,amount_cents) values (%L,%L,''inv-4'',1000)', a, p5)),
      ('application to an unposted (draft) invoice',  '23514', format('insert into payment_applications (user_id,payment_id,invoice_id,amount_cents) values (%L,%L,''inv-3'',1000)', a, p5)),
      ('payment inserted without a ledger entry',     '23514', format('insert into payments (user_id,payment_date,amount_cents,deposit_account_id) values (%L,''2026-06-01'',500,%L)', a, chk)),
      ('payment amount changed without reposting',    '23514', format('update payments set amount_cents = 31000 where id = %L', p1)),
      ('payment voided without reversing the ledger', '23514', format('update payments set voided_at = now() where id = %L', p1)),
      ('invoice cut below what is applied',           '23514', 'update invoices set amount = 20000 where id = ''inv-1'''),
      ('delete an invoice that has applications',     '23503', 'delete from invoices where id = ''inv-1'''),
      ('delete a payment that has applications',      '23503', format('delete from payments where id = %L', p1)),
      ('delete a live (posted) payment',              '23503', format('delete from payments where id = %L', p5))
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

    -- reconciliation: A/R in the ledger = posted invoices - live payments
    select coalesce(sum(amount), 0) into v from invoices where id in ('inv-1','inv-2','inv-4');
    select v - coalesce(sum(amount_cents), 0) into v from payments where voided_at is null;
    select balance_cents into v2 from account_balances where account_id = ar;
    if v = v2 then results := results || 'PASS A/R in the ledger = posted invoices - live payments'::text; else failures := failures || ('FAIL AR recon ' || v || '/' || v2); end if;
    select sum(debit_total), sum(credit_total) into v, v2 from account_balances where user_id = a;
    if v = v2 then results := results || 'PASS inv 8: debits = credits'::text; else failures := failures || 'FAIL inv 8'; end if;
  end;

  -- ---- other users and roles ----
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  for t in select * from (values
    ('B updating A''s payment', 'P0002', format('select update_payment(%L,null,''2026-06-01'',100,%L,''[]'')', p1, b_chk)),
    ('B voiding A''s payment',  'P0002', format('select void_payment(%L)', p1)),
    ('B applying a payment to A''s invoice', 'P0002', format('select record_payment(null,''2026-06-01'',100,%L,''[{"invoice_id":"inv-2","amount_cents":100}]'')', b_chk)),
    ('B depositing to A''s account', '23514', format('select record_payment(null,''2026-06-01'',100,%L,''[]'')', chk)),
    ('authenticated INSERT payments', '42501', format('insert into payments (user_id,payment_date,amount_cents,deposit_account_id) values (auth.uid(),''2026-06-01'',1,%L)', b_chk)),
    ('authenticated INSERT payment_applications', '42501', 'insert into payment_applications (user_id,payment_id,invoice_id,amount_cents) values (auth.uid(), gen_random_uuid(), ''x'', 1)'),
    ('authenticated UPDATE payments', '42501', 'update payments set amount_cents = 1')
  ) as v(label, code, s)
  loop
    begin execute t.s; failures := failures || ('FAIL accepted: ' || t.label);
    exception when others then
      if sqlstate = t.code then results := results || ('PASS rejected: ' || t.label);
      else failures := failures || ('FAIL ' || t.label || ' -> ' || sqlstate || ' ' || sqlerrm); end if;
    end;
  end loop;
  select count(*) into n from payments; select n + count(*) into n from payment_applications;
  if n = 0 then results := results || 'PASS B sees none of A''s payments or applications'::text; else failures := failures || 'FAIL B sees A payments'; end if;
  reset role;

  perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  set local role authenticated;
  begin perform record_payment(null,'2026-06-01',100,chk,'[]'); failures := failures || 'FAIL unauth';
  exception when others then if sqlstate = '28000' then results := results || 'PASS not signed in is refused'::text; else failures := failures || ('FAIL unauth ' || sqlstate); end if; end;
  reset role;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  begin perform record_payment(null,'2026-06-01',100,chk,'[]'); failures := failures || 'FAIL anon';
  exception when insufficient_privilege then results := results || 'PASS anon cannot execute record_payment'::text; end;
  reset role;

  -- ---- deleting a user cascades through payments and the immutable ledger ----
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform record_payment(null, '2026-06-01', 1000, c_chk, '[]');
  reset role;
  begin
    set constraints all immediate; set constraints all deferred;
    delete from auth.users where id = c;
    select count(*) into n from payments where user_id = c; select n + count(*) into n from journal_entries where user_id = c;
    if n = 0 then results := results || 'PASS deleting a user removes their payments and ledger'::text; else failures := failures || 'FAIL user delete left rows'; end if;
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
