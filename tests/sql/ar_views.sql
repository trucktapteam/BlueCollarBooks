-- Stage C4 tests: derived invoice balance/status, A/R aging (as-of dates), payment balances, A/R reconciliation.
-- One DO block, always rolls back. Success = message starts 'ROLLED BACK - ALL PASS'.
do $test$
declare
  a uuid := '00000000-0000-4000-8000-0000000000aa';
  b uuid := '00000000-0000-4000-8000-0000000000bb';
  chk uuid; p1 uuid; p2 uuid; r record; n int; s text;
  results text[] := '{}'; failures text[] := '{}';
begin
  insert into auth.users (id,email,aud,role) values (a,'ta@example.invalid','authenticated','authenticated'),(b,'tb@example.invalid','authenticated','authenticated');
  insert into customers (id,user_id,name) values ('c1',a,'ACME'),('c2',a,'Other Co');
  insert into bank_accounts (id,user_id,name,last4,balance,last_updated) values ('bk1',a,'Checking','1111',0,'x');
  perform seed_chart_of_accounts(a); perform seed_chart_of_accounts(b);
  select id into chk from accounts where bank_account_id='bk1';

  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform save_invoice('{"id":"inv-1","invoice_number":"1001","customer":"ACME","customer_id":"c1","amount":50000,"status":"Sent","invoice_date":"2026-05-01","due_date":"2026-05-31"}', '[]');
  perform save_invoice('{"id":"inv-2","invoice_number":"1002","customer":"ACME","customer_id":"c1","amount":30000,"status":"Sent","invoice_date":"2026-06-01","due_date":"2026-07-01"}', '[]');
  perform save_invoice('{"id":"inv-3","invoice_number":"1003","customer":"ACME","customer_id":"c1","amount":20000,"status":"Draft","invoice_date":"2026-06-03"}', '[]');
  perform save_invoice('{"id":"inv-4","invoice_number":"1004","customer":"Other Co","customer_id":"c2","amount":10000,"status":"Sent","invoice_date":"2026-03-02","due_date":"2026-04-01"}', '[]');
  -- inv-5 is deliberately NOT posted: save_invoice posts now, so it is inserted directly as the privileged role
  reset role;
  insert into invoices (id,user_id,invoice_number,customer,customer_id,amount,status,invoice_date,due_date)
    values ('inv-5',a,'1005','ACME','c1',9900,'Sent','2026-06-04','2026-07-04');
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  p1 := record_payment('c1', '2026-06-05', 20000, chk, '[{"invoice_id":"inv-1","amount_cents":20000}]');
  p2 := record_payment('c1', '2026-06-20', 7000, chk, '[]');

  -- as of 2026-07-31
  select string_agg(invoice_id || '=' || balance_cents || '/' || derived_status || '/' || coalesce(days_past_due::text,'-'), ', ' order by invoice_id) into s from invoice_balances_as_of('2026-07-31');
  if s = 'inv-1=30000/Overdue/61, inv-2=30000/Overdue/30, inv-3=0/Draft/-, inv-4=10000/Overdue/121, inv-5=0/Not posted/-'
  then results := results || 'PASS balances and derived statuses (Draft, Not posted, Overdue; partial payment leaves the remainder)'::text;
  else failures := failures || ('FAIL balances: ' || s); end if;

  select string_agg(invoice_id || ':' || bucket, ', ' order by invoice_id) into s from ar_aging_as_of('2026-07-31');
  if s = 'inv-1:61-90, inv-2:1-30, inv-4:90+' then results := results || 'PASS A/R aging buckets (1-30, 61-90, 90+); drafts and unposted invoices excluded'::text;
  else failures := failures || ('FAIL aging: ' || s); end if;

  -- as-of in the past: payment of 06-05 not yet received, invoice 2 not yet due
  select string_agg(invoice_id || ':' || balance_cents || ':' || bucket, ', ' order by invoice_id) into s from ar_aging_as_of('2026-06-03');
  if s = 'inv-1:50000:1-30, inv-2:30000:Current, inv-4:10000:61-90' then results := results || 'PASS aging as of an earlier date ignores later payments'::text;
  else failures := failures || ('FAIL past aging: ' || s); end if;

  -- paying in full -> Paid, leaves aging
  perform record_payment('c1', '2026-07-10', 30000, chk, '[{"invoice_id":"inv-2","amount_cents":30000}]');
  select derived_status || '/' || balance_cents into s from invoice_balances_as_of('2026-07-31') where invoice_id = 'inv-2';
  if s = 'Paid/0' and not exists (select 1 from ar_aging_as_of('2026-07-31') where invoice_id = 'inv-2')
  then results := results || 'PASS fully paid invoice shows Paid with zero balance and leaves aging'::text; else failures := failures || ('FAIL paid: ' || coalesce(s,'null')); end if;

  -- payment balances
  select unapplied_cents into r from payment_balances where payment_id = p2;
  if r.unapplied_cents = 7000 and (select unapplied_cents from payment_balances where payment_id = p1) = 0
  then results := results || 'PASS payment balances: unapplied customer credit tracked'::text; else failures := failures || 'FAIL payment balances'; end if;

  -- books agree with the sub-ledger on several dates
  for r in select d from (values (date '2026-06-03'), (date '2026-06-30'), (date '2026-07-31'), (date '2026-12-31')) x(d) loop
    select count(*) into n from ar_reconciliation_as_of(r.d) where difference_cents <> 0;
    if n = 0 then results := results || ('PASS A/R reconciles to the sub-ledger as of ' || r.d);
    else failures := failures || ('FAIL A/R mismatch as of ' || r.d); end if;
  end loop;

  -- voiding a payment keeps it reconciled and reopens the balance
  perform void_payment(p1);
  select balance_cents into r from invoice_balances_as_of('2026-07-31') where invoice_id = 'inv-1';
  if r.balance_cents = 50000 and (select difference_cents from ar_reconciliation_as_of('2026-07-31')) = 0
  then results := results || 'PASS void reopens the balance and A/R still reconciles'::text; else failures := failures || 'FAIL void recon'; end if;

  -- isolation
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  select count(*) into n from invoice_balances_as_of('2026-07-31'); select n + count(*) into n from ar_aging_as_of('2026-07-31');
  select n + count(*) into n from payment_balances; select n + count(*) into n from invoice_balances;
  if n = 0 and (select ledger_ar_cents from ar_reconciliation_as_of('2026-07-31')) = 0
  then results := results || 'PASS B sees none of A''s balances, aging or payments'::text; else failures := failures || 'FAIL B sees A data'; end if;
  reset role;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  begin perform 1 from invoice_balances_as_of('2026-07-31'); failures := failures || 'FAIL anon read balances';
  exception when insufficient_privilege then results := results || 'PASS anon cannot read balances'::text; end;
  begin perform 1 from ar_aging; failures := failures || 'FAIL anon read aging';
  exception when insufficient_privilege then results := results || 'PASS anon cannot read the aging view'::text; end;
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
