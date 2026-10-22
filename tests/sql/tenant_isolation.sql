-- Stage A database tests: two-user isolation, cross-tenant FK hole, CHECK constraints.
-- Run against the Supabase project via the SQL editor / execute_sql. The whole thing
-- runs in one DO block and ALWAYS ends by raising, so nothing is ever committed.
-- Success = the final error message starts with 'ROLLED BACK - ALL PASS'.
do $test$
declare
  a uuid := '00000000-0000-4000-8000-0000000000aa';
  b uuid := '00000000-0000-4000-8000-0000000000bb';
  n int;
  results text[] := '{}';
  failures text[] := '{}';

begin
  -- ---------- setup (as the privileged role) ----------
  insert into auth.users (id, email, aud, role) values
    (a, 'test-a@example.invalid', 'authenticated', 'authenticated'),
    (b, 'test-b@example.invalid', 'authenticated', 'authenticated');

  insert into customers (id, user_id, name) values ('cust-a', a, 'A Customer'), ('cust-b', b, 'B Customer');
  insert into invoices (id, user_id, invoice_number, customer, amount, status, invoice_date)
    values ('inv-a', a, 'A-1', 'A Customer', 10000, 'Sent', '2026-06-01');
  insert into expenses (id, user_id, vendor, amount, date) values ('exp-a', a, 'A Vendor', 500, '2026-06-02');
  insert into plaid_items (id, user_id, item_id, access_token) values ('pi-b', b, 'item-b', 'token-b');

  -- ---------- positive control: same-owner children are allowed ----------
  begin
    insert into invoice_line_items (id, invoice_id, user_id, description, amount, position) values ('li-a', 'inv-a', a, 'ok', 10000, 0);
    insert into invoice_attachments (id, invoice_id, user_id, name, type) values ('att-a', 'inv-a', a, 'f.pdf', 'application/pdf');
    insert into expense_receipts (id, expense_id, user_id, name, type) values ('rc-a', 'exp-a', a, 'r.pdf', 'application/pdf');
    results := results || 'PASS same-owner children insert'::text;
  exception when others then
    failures := failures || ('FAIL same-owner children insert: ' || sqlerrm);
  end;

  -- ---------- cross-tenant FK hole (privileged role, so RLS is NOT in the way) ----------
  -- B-owned child rows pointing at A's parent ids must be rejected by the database itself.
  declare
    t record;
  begin
    for t in select * from (values
      ('line item -> other user''s invoice',   $q$insert into invoice_line_items (id, invoice_id, user_id, description, amount, position) values ('x1','inv-a','00000000-0000-4000-8000-0000000000bb','x',1,0)$q$),
      ('attachment -> other user''s invoice',  $q$insert into invoice_attachments (id, invoice_id, user_id, name, type) values ('x3','inv-a','00000000-0000-4000-8000-0000000000bb','f','t')$q$),
      ('receipt -> other user''s expense',     $q$insert into expense_receipts (id, expense_id, user_id, name, type) values ('x4','exp-a','00000000-0000-4000-8000-0000000000bb','f','t')$q$),
      ('invoice -> other user''s customer',    $q$insert into invoices (id, user_id, invoice_number, customer, customer_id, amount, status) values ('x5','00000000-0000-4000-8000-0000000000bb','B-1','c','cust-a',1,'Draft')$q$),
      ('bank txn -> other user''s expense',    $q$insert into plaid_transactions (id, user_id, plaid_item_id, plaid_account_id, date, name, amount, pending, excluded, expense_id) values ('x6','00000000-0000-4000-8000-0000000000bb','item-b','acct','2026-06-01','n',1,false,false,'exp-a')$q$),
      ('bank txn -> other user''s plaid item', $q$insert into plaid_transactions (id, user_id, plaid_item_id, plaid_account_id, date, name, amount, pending, excluded) values ('x7','00000000-0000-4000-8000-0000000000aa','item-b','acct','2026-06-01','n',1,false,false)$q$)
    ) as v(label, stmt)
    loop
      begin
        execute t.stmt;
        failures := failures || ('FAIL (hole open) ' || t.label);
      exception when foreign_key_violation then
        results := results || ('PASS blocked: ' || t.label);
      when others then
        failures := failures || ('FAIL unexpected error for ' || t.label || ': ' || sqlerrm);
      end;
    end loop;
  end;

  -- ---------- CHECK constraints ----------
  declare
    t record;
  begin
    for t in select * from (values
      ('invoice with unknown status',      $q$insert into invoices (id, user_id, invoice_number, customer, amount, status) values ('c1','00000000-0000-4000-8000-0000000000aa','C-1','c',1,'Banana')$q$),
      ('invoice with negative amount',     $q$insert into invoices (id, user_id, invoice_number, customer, amount, status) values ('c2','00000000-0000-4000-8000-0000000000aa','C-2','c',-1,'Draft')$q$),
      ('invoice with blank number',        $q$insert into invoices (id, user_id, invoice_number, customer, amount, status) values ('c3','00000000-0000-4000-8000-0000000000aa','  ','c',1,'Draft')$q$),
      ('invoice due before invoice date',  $q$insert into invoices (id, user_id, invoice_number, customer, amount, status, invoice_date, due_date) values ('c4','00000000-0000-4000-8000-0000000000aa','C-4','c',1,'Draft','2026-06-10','2026-06-01')$q$),
      ('invoice dated year 1900',          $q$insert into invoices (id, user_id, invoice_number, customer, amount, status, invoice_date) values ('c5','00000000-0000-4000-8000-0000000000aa','C-5','c',1,'Draft','1900-01-01')$q$),
      ('negative expense',                 $q$insert into expenses (id, user_id, vendor, amount) values ('c8','00000000-0000-4000-8000-0000000000aa','v',-1)$q$),
      ('duplicate invoice number',         $q$insert into invoices (id, user_id, invoice_number, customer, amount, status) values ('c9','00000000-0000-4000-8000-0000000000aa','A-1','c',1,'Draft')$q$)
    ) as v(label, stmt)
    loop
      begin
        execute t.stmt;
        failures := failures || ('FAIL accepted: ' || t.label);
      exception when check_violation or unique_violation then
        results := results || ('PASS rejected: ' || t.label);
      when others then
        failures := failures || ('FAIL unexpected error for ' || t.label || ': ' || sqlerrm);
      end;
    end loop;
  end;

  -- ---------- deleting a customer must not wipe the invoice's owner ----------
  begin
    insert into invoices (id, user_id, invoice_number, customer, customer_id, amount, status)
      values ('inv-a2', a, 'A-2', 'A Customer', 'cust-a', 1, 'Draft');
    delete from customers where id = 'cust-a';
    select count(*) into n from invoices where id = 'inv-a2' and user_id = a and customer_id is null;
    if n = 1 then results := results || 'PASS deleting a customer keeps invoice + owner, clears customer_id'::text;
    else failures := failures || 'FAIL customer delete damaged invoice'::text; end if;
  exception when others then
    failures := failures || ('FAIL customer delete: ' || sqlerrm);
  end;

  -- ---------- RLS isolation as signed-in user B ----------
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;

  declare
    tbl text;
  begin
    foreach tbl in array array['invoices','invoice_line_items','payments','invoice_attachments','expenses','expense_receipts','customers','activity_log','plaid_transactions','bank_accounts','expense_categories','business_settings','subscriptions'] loop
      execute format('select count(*) from %I where user_id = %L', tbl, a) into n;
      if n = 0 then results := results || ('PASS B cannot read A rows in ' || tbl);
      else failures := failures || ('FAIL B can read ' || n || ' of A rows in ' || tbl); end if;
    end loop;
  end;

  -- Stage E: app roles have no write privilege on invoices at all (writes go through save_invoice / delete_invoice,
  -- which are scoped to the signed-in user), so the attempt is refused outright; the old row-count-0 outcome is also acceptable.
  begin
    update invoices set amount = 1 where id = 'inv-a';
    get diagnostics n = row_count;
    if n = 0 then results := results || 'PASS B cannot update A invoice'::text; else failures := failures || 'FAIL B updated A invoice'::text; end if;
  exception when insufficient_privilege then results := results || 'PASS B cannot update A invoice (no privilege)'::text;
  when others then failures := failures || ('FAIL B update attempt errored: ' || sqlerrm);
  end;
  begin
    delete from invoices where id = 'inv-a';
    get diagnostics n = row_count;
    if n = 0 then results := results || 'PASS B cannot delete A invoice'::text; else failures := failures || 'FAIL B deleted A invoice'::text; end if;
  exception when insufficient_privilege then results := results || 'PASS B cannot delete A invoice (no privilege)'::text;
  when others then failures := failures || ('FAIL B delete attempt errored: ' || sqlerrm);
  end;

  begin
    insert into invoices (id, user_id, invoice_number, customer, amount, status) values ('rls1', a, 'RLS-1', 'c', 1, 'Draft');
    failures := failures || 'FAIL B inserted a row owned by A'::text;
  exception when insufficient_privilege then
    results := results || 'PASS B cannot insert a row owned by A (RLS)'::text;
  when others then
    failures := failures || ('FAIL B insert-as-A unexpected: ' || sqlerrm);
  end;

  begin
    select count(*) into n from plaid_items;   -- RLS on, zero policies = no access
    if n = 0 then results := results || 'PASS B sees no plaid_items (tokens server-only)'::text;
    else failures := failures || 'FAIL B can see plaid_items'::text; end if;
  exception when insufficient_privilege then
    results := results || 'PASS B has no access to plaid_items'::text;
  end;

  reset role;

  -- ---------- anonymous (not signed in) ----------
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  declare
    tbl text;
  begin
    foreach tbl in array array['invoices','expenses','customers','plaid_transactions','bank_accounts','plaid_items','subscriptions'] loop
      begin
        execute format('select count(*) from %I', tbl) into n;
        if n = 0 then results := results || ('PASS anon sees 0 rows in ' || tbl);
        else failures := failures || ('FAIL anon sees ' || n || ' rows in ' || tbl); end if;
      exception when insufficient_privilege then
        results := results || ('PASS anon denied on ' || tbl);
      end;
    end loop;
  end;
  reset role;

  if array_length(failures, 1) is null then
    raise exception 'ROLLED BACK - ALL PASS (% checks): %', array_length(results, 1), array_to_string(results, ' | ');
  else
    raise exception 'ROLLED BACK - % FAILURES: % || PASSED: %', array_length(failures, 1), array_to_string(failures, ' | '), array_to_string(results, ' | ');
  end if;
end
$test$;
