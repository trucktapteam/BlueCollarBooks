-- Stage C1 tests: save_invoice is atomic, edits line items in place, and respects ownership.
-- One DO block, always rolls back. Success = message starts 'ROLLED BACK - ALL PASS'.
do $test$
declare
  a uuid := '00000000-0000-4000-8000-0000000000aa';
  b uuid := '00000000-0000-4000-8000-0000000000bb';
  n int; s text; results text[] := '{}'; failures text[] := '{}';
  base jsonb := '{"id":"inv-1","invoice_number":"1001","customer":"ACME","amount":30000,"status":"Sent","invoice_date":"2026-06-01","terms":"Net 30","due_date":"2026-07-01"}';
begin
  insert into auth.users (id,email,aud,role) values (a,'ta@example.invalid','authenticated','authenticated'),(b,'tb@example.invalid','authenticated','authenticated');
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- create with two lines
  perform save_invoice(base, '[{"id":"l1","description":"Freight","amount":10000},{"id":"l2","description":"Fuel","amount":20000,"service_date":"2026-05-28","quantity":2,"rate_cents":10000}]');
  select count(*) into n from invoice_line_items where invoice_id='inv-1';
  if n = 2 and (select terms from invoices where id='inv-1') = 'Net 30' and (select due_date from invoices where id='inv-1') = date '2026-07-01'
     and (select service_date from invoice_line_items where id='l2') = date '2026-05-28' and (select quantity from invoice_line_items where id='l2') = 2
  then results := results || 'PASS create: invoice, terms, due_date and 2 lines (with service date/quantity/rate) saved'::text;
  else failures := failures || 'FAIL create'; end if;

  -- edit in place: l1 changed, l2 removed, l3 added
  perform save_invoice(base || '{"amount":25000}', '[{"id":"l3","description":"New","amount":5000},{"id":"l1","description":"Freight v2","amount":20000}]');
  select string_agg(id || ':' || position || ':' || amount, ',' order by position) into s from invoice_line_items where invoice_id='inv-1';
  if s = 'l3:0:5000,l1:1:20000' and (select amount from invoices where id='inv-1') = 25000
     and (select description from invoice_line_items where id='l1') = 'Freight v2'
  then results := results || 'PASS edit: l1 updated in place, l2 removed, l3 added, order kept'::text;
  else failures := failures || ('FAIL edit ' || coalesce(s,'null')); end if;

  -- atomic: a bad line in the middle of an edit leaves invoice header AND lines untouched
  begin
    perform save_invoice(base || '{"customer":"CHANGED","amount":1}', '[{"id":"l1","description":"x","amount":100},{"id":"l9","description":"bad","amount":"abc"}]');
    failures := failures || 'FAIL bad line accepted';
  exception when others then
    select string_agg(id || ':' || amount, ',' order by position) into s from invoice_line_items where invoice_id='inv-1';
    if (select customer from invoices where id='inv-1') = 'ACME' and (select amount from invoices where id='inv-1') = 25000 and s = 'l3:5000,l1:20000'
    then results := results || 'PASS failed save is atomic: header and line items unchanged'::text;
    else failures := failures || ('FAIL atomicity: ' || sqlstate || ' ' || coalesce(s,'null')); end if;
  end;

  -- duplicate invoice number
  begin
    perform save_invoice('{"id":"inv-2","invoice_number":"1001","customer":"X","amount":1,"status":"Draft"}', '[]');
    failures := failures || 'FAIL duplicate number accepted';
  exception when unique_violation then results := results || 'PASS duplicate invoice number rejected (23505)'::text;
  when others then failures := failures || ('FAIL duplicate wrong error ' || sqlstate); end;

  -- bad values
  begin perform save_invoice(base || '{"amount":-5}', '[]'); failures := failures || 'FAIL negative amount';
  exception when check_violation then results := results || 'PASS negative amount rejected'::text; when others then failures := failures || ('FAIL neg ' || sqlstate); end;
  begin perform save_invoice(base || '{"status":"Banana"}', '[]'); failures := failures || 'FAIL bad status';
  exception when check_violation then results := results || 'PASS unknown status rejected'::text; when others then failures := failures || ('FAIL status ' || sqlstate); end;

  -- empty list removes all lines
  perform save_invoice(base, '[]');
  select count(*) into n from invoice_line_items where invoice_id='inv-1';
  if n = 0 then results := results || 'PASS empty line list clears lines'::text; else failures := failures || 'FAIL clear'; end if;
  perform save_invoice(base, '[{"id":"l1","description":"Back","amount":25000}]');

  -- another user cannot overwrite or hijack
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  begin
    perform save_invoice(base || '{"customer":"HIJACK"}', '[]');
    failures := failures || 'FAIL B overwrote A invoice';
  exception when others then results := results || ('PASS B cannot overwrite A''s invoice (' || sqlstate || ')'); end;
  begin
    perform save_invoice('{"id":"inv-b","invoice_number":"B1","customer":"B","amount":1,"status":"Draft"}', '[{"id":"l1","description":"steal","amount":1}]');
    failures := failures || 'FAIL B took A line id';
  exception when others then
    if sqlstate in ('23505','42501') and not exists (select 1 from invoices where id='inv-b') then results := results || 'PASS B cannot reuse A''s line item id; nothing persisted'::text;
    else failures := failures || ('FAIL line hijack ' || sqlstate); end if;
  end;
  reset role;
  if (select customer from invoices where id='inv-1') = 'ACME' and (select count(*) from invoice_line_items where id='l1' and user_id=a) = 1
  then results := results || 'PASS A''s data intact after B''s attempts'::text; else failures := failures || 'FAIL A data changed'; end if;

  perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  set local role authenticated;
  begin perform save_invoice(base, '[]'); failures := failures || 'FAIL unauthenticated save';
  exception when others then if sqlstate = '28000' then results := results || 'PASS not signed in is refused'::text; else failures := failures || ('FAIL noauth ' || sqlstate); end if; end;
  reset role;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  begin perform save_invoice(base, '[]'); failures := failures || 'FAIL anon executed';
  exception when insufficient_privilege then results := results || 'PASS anon cannot execute save_invoice'::text; end;
  reset role;

  if array_length(failures,1) is null then
    raise exception 'ROLLED BACK - ALL PASS (% checks): %', array_length(results,1), array_to_string(results,' | ');
  else
    raise exception 'ROLLED BACK - % FAILURES: % || PASSED: %', array_length(failures,1), array_to_string(failures,' | '), array_to_string(results,' | ');
  end if;
end
$test$;
