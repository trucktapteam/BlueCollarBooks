-- Stage C2 tests: invoice ledger posting (Dr A/R / Cr Income), drafts post nothing, edits = reversal + repost,
-- DB-enforced consistency, ownership. One DO block, always rolls back.
-- Success = message starts 'ROLLED BACK - ALL PASS'.
do $test$
declare
  a uuid := '00000000-0000-4000-8000-0000000000aa';
  b uuid := '00000000-0000-4000-8000-0000000000bb';
  n int; v bigint; e1 uuid; e2 uuid; results text[] := '{}'; failures text[] := '{}';
  ar uuid; inc uuid; cnt0 int;
  inv jsonb := '{"id":"inv-1","invoice_number":"1001","customer":"ACME","amount":50000,"status":"Draft","invoice_date":"2026-06-01","terms":"Net 30","due_date":"2026-07-01"}';
  lines jsonb := '[{"id":"l1","description":"Freight","amount":50000,"service_date":"2026-05-20"}]';
begin
  insert into auth.users (id,email,aud,role) values (a,'ta@example.invalid','authenticated','authenticated'),(b,'tb@example.invalid','authenticated','authenticated');
  perform seed_chart_of_accounts(a); perform seed_chart_of_accounts(b);
  select id into ar  from accounts where user_id=a and system_key='accounts_receivable';
  select id into inc from accounts where user_id=a and system_key='income';
  execute 'create function pg_temp.bal(p uuid) returns bigint language sql as $f$ select balance_cents from account_balances where account_id = p $f$';
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- drafts post nothing (inv 20)
  perform save_invoice(inv, lines);
  if sync_invoice_posting('inv-1') is null and (select count(*) from journal_entries) = 0 and pg_temp.bal(ar) = 0
  then results := results || 'PASS inv 20: a draft invoice posts nothing'::text; else failures := failures || 'FAIL draft posted'; end if;

  -- sending posts Dr A/R / Cr Income, dated the invoice date (inv 19: service date stays separate)
  perform save_invoice(inv || '{"status":"Sent"}', lines);
  e1 := sync_invoice_posting('inv-1');
  if e1 is not null and pg_temp.bal(ar) = 50000 and pg_temp.bal(inc) = 50000
     and (select entry_date from journal_entries where id = e1) = date '2026-06-01'
     and (select service_date from invoice_line_items where id = 'l1') = date '2026-05-20'
     and (select source_type || ':' || source_id from journal_entries where id = e1) = 'invoice:inv-1'
  then results := results || 'PASS sent invoice: Dr A/R / Cr Income on the invoice date; service date stays distinct; source traceable'::text;
  else failures := failures || ('FAIL post ' || pg_temp.bal(ar) || '/' || pg_temp.bal(inc)); end if;

  -- idempotent
  select count(*) into cnt0 from journal_entries;
  if sync_invoice_posting('inv-1') = e1 and (select count(*) from journal_entries) = cnt0
  then results := results || 'PASS sync is idempotent (same entry, nothing new)'::text; else failures := failures || 'FAIL not idempotent'; end if;

  -- marking Paid creates no second income
  perform save_invoice(inv || '{"status":"Paid"}', lines);
  if sync_invoice_posting('inv-1') = e1 and pg_temp.bal(inc) = 50000
  then results := results || 'PASS status change to Paid creates no second income'::text; else failures := failures || 'FAIL paid changed ledger'; end if;
  perform save_invoice(inv || '{"status":"Sent"}', lines);

  -- editing a posted invoice WITHOUT syncing is rejected by the database at commit
  begin
    perform save_invoice(inv || '{"status":"Sent","amount":60000}', '[{"id":"l1","description":"Freight","amount":60000}]');
    set constraints all immediate;
    failures := failures || 'FAIL drift accepted';
  exception when others then
    if sqlstate = '23514' then results := results || 'PASS DB rejects a posted invoice that drifts from its ledger entry'::text;
    else failures := failures || ('FAIL drift wrong error ' || sqlstate || ' ' || sqlerrm); end if;
  end;
  set constraints all deferred;

  -- edit amount + sync = reversal + repost
  perform save_invoice(inv || '{"status":"Sent","amount":60000}', '[{"id":"l1","description":"Freight","amount":60000}]');
  e2 := sync_invoice_posting('inv-1');
  if e2 <> e1 and pg_temp.bal(ar) = 60000 and pg_temp.bal(inc) = 60000
     and (select count(*) from journal_entry_trace where source_id='inv-1') = 3
     and (select count(*) from journal_entry_trace where source_id='inv-1' and status='active') = 1
  then results := results || 'PASS edited invoice: reversal + replacement, 3 entries, 1 active, balances = new amount'::text;
  else failures := failures || ('FAIL repost ' || pg_temp.bal(ar)); end if;

  -- date change keeps history in the right periods
  perform save_invoice(inv || '{"status":"Sent","amount":60000,"invoice_date":"2026-07-15","due_date":"2026-08-14"}', '[{"id":"l1","description":"Freight","amount":60000}]');
  e1 := sync_invoice_posting('inv-1');
  if (select entry_date from journal_entries where id = e1) = date '2026-07-15' and pg_temp.bal(ar) = 60000
  then results := results || 'PASS invoice date change reposts on the new date'::text; else failures := failures || 'FAIL date repost'; end if;

  -- back to draft reverses; sending again reposts
  perform save_invoice(inv || '{"status":"Draft","amount":60000,"invoice_date":"2026-07-15","due_date":"2026-08-14"}', '[{"id":"l1","description":"Freight","amount":60000}]');
  if sync_invoice_posting('inv-1') is null and pg_temp.bal(ar) = 0 and pg_temp.bal(inc) = 0
  then results := results || 'PASS back to Draft reverses the posting'::text; else failures := failures || 'FAIL draft reverse'; end if;
  perform save_invoice(inv || '{"status":"Sent","amount":60000,"invoice_date":"2026-07-15","due_date":"2026-08-14"}', '[{"id":"l1","description":"Freight","amount":60000}]');
  if sync_invoice_posting('inv-1') is not null and pg_temp.bal(ar) = 60000
  then results := results || 'PASS re-sending after draft posts again'::text; else failures := failures || 'FAIL resend'; end if;

  -- cannot delete a posted invoice
  begin delete from invoices where id = 'inv-1'; failures := failures || 'FAIL deleted posted invoice';
  exception when foreign_key_violation then results := results || 'PASS a posted invoice cannot be deleted until reversed'::text;
  when others then failures := failures || ('FAIL delete wrong error ' || sqlstate); end;

  -- unsendable invoices
  perform save_invoice('{"id":"inv-2","invoice_number":"1002","customer":"Z","amount":0,"status":"Sent","invoice_date":"2026-06-01"}', '[]');
  begin perform sync_invoice_posting('inv-2'); failures := failures || 'FAIL zero invoice posted';
  exception when others then if sqlstate = '23514' then results := results || 'PASS zero-dollar invoice cannot be sent'::text; else failures := failures || ('FAIL zero ' || sqlstate); end if; end;
  perform save_invoice('{"id":"inv-3","invoice_number":"1003","customer":"Z","amount":100,"status":"Sent"}', '[]');
  begin perform sync_invoice_posting('inv-3'); failures := failures || 'FAIL undated invoice posted';
  exception when others then if sqlstate = '23514' then results := results || 'PASS invoice without a date cannot be sent'::text; else failures := failures || ('FAIL undated ' || sqlstate); end if; end;
  perform save_invoice('{"id":"inv-4","invoice_number":"1004","customer":"Z","amount":200,"status":"Sent","invoice_date":"2026-06-01"}', '[{"id":"m1","description":"x","amount":100}]');
  begin perform sync_invoice_posting('inv-4'); failures := failures || 'FAIL mismatch posted';
  exception when others then if sqlstate = '23514' then results := results || 'PASS invoice total must equal its line items'::text; else failures := failures || ('FAIL mismatch ' || sqlstate); end if; end;
  -- draft can be deleted freely
  delete from invoices where id = 'inv-2';
  if not exists (select 1 from invoices where id = 'inv-2') then results := results || 'PASS unposted invoices can be deleted'::text; else failures := failures || 'FAIL delete draft'; end if;

  -- other users / roles
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  begin perform sync_invoice_posting('inv-1'); failures := failures || 'FAIL B synced A invoice';
  exception when others then if sqlstate = 'P0002' then results := results || 'PASS B cannot post A''s invoice'::text; else failures := failures || ('FAIL B sync ' || sqlstate); end if; end;
  reset role;
  perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  set local role authenticated;
  begin perform sync_invoice_posting('inv-1'); failures := failures || 'FAIL unauth';
  exception when others then if sqlstate = '28000' then results := results || 'PASS not signed in is refused'::text; else failures := failures || ('FAIL unauth ' || sqlstate); end if; end;
  reset role;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  begin perform sync_invoice_posting('inv-1'); failures := failures || 'FAIL anon';
  exception when insufficient_privilege then results := results || 'PASS anon cannot execute sync_invoice_posting'::text; end;
  reset role;

  -- whole-ledger invariants
  select sum(debit_total), sum(credit_total) into v, n from account_balances where user_id = a;
  if v = n then results := results || 'PASS inv 8: debits = credits'::text; else failures := failures || 'FAIL inv 8'; end if;
  begin set constraints all immediate; results := results || 'PASS all deferred checks hold at commit'::text;
  exception when others then failures := failures || ('FAIL deferred ' || sqlerrm); end;

  if array_length(failures,1) is null then
    raise exception 'ROLLED BACK - ALL PASS (% checks): %', array_length(results,1), array_to_string(results,' | ');
  else
    raise exception 'ROLLED BACK - % FAILURES: % || PASSED: %', array_length(failures,1), array_to_string(failures,' | '), array_to_string(results,' | ');
  end if;
end
$test$;
