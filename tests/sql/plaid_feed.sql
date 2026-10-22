-- Stage F1 tests: pending -> posted identity, removals, atomic sync page, and the lockdown of direct writes
-- to the bank feed. One DO block, always rolls back. Success = message starts 'ROLLED BACK - ALL PASS'.
do $test$
declare
  a uuid := '00000000-0000-4000-8000-0000000000aa';
  b uuid := '00000000-0000-4000-8000-0000000000bb';
  n int; t record; r jsonb;
  results text[] := '{}'; failures text[] := '{}';
begin
  insert into auth.users (id,email,aud,role) values (a,'ta@example.invalid','authenticated','authenticated'),(b,'tb@example.invalid','authenticated','authenticated');
  insert into plaid_items (id,user_id,item_id,access_token) values ('pi-a',a,'item-a','x'),('pi-a2',a,'item-a2','x'),('pi-b',b,'item-b','x');
  insert into bank_accounts (id,user_id,name,last4,balance,last_updated,plaid_item_id,plaid_account_id) values
    ('bk1',a,'Checking','1111',0,'x','item-a','pa1'),('bkb',b,'B Checking','9999',0,'x','item-b','pab');
  execute 'create function pg_temp.st(i text) returns text language sql as $f$ select status || coalesce(''>'' || superseded_by, '''') from plaid_transactions where id = i $f$';

  -- ---- a normal page ----
  r := apply_plaid_sync_page(a, 'item-a',
    '[{"id":"p1","plaid_account_id":"pa1","date":"2026-06-10","name":"LOVES","merchant_name":"Loves","amount":8000,"pending":true,"plaid_category":"X"},
      {"id":"p2","plaid_account_id":"pa1","date":"2026-06-11","name":"SHELL","amount":3000,"pending":true}]', '[]', '[]');
  if (select count(*) from plaid_transactions where user_id = a and status = 'active') = 2 and (r->>'upserted')::int = 2
  then results := results || 'PASS a sync page writes its rows'::text; else failures := failures || 'FAIL page write'::text; end if;
  perform apply_plaid_sync_page(a, 'item-a', '[]', '[{"id":"p2","plaid_account_id":"pa1","date":"2026-06-11","name":"SHELL","amount":3100,"pending":true}]', '[]');
  if (select amount from plaid_transactions where id = 'p2') = 3100 then results := results || 'PASS a modified transaction updates in place'::text; else failures := failures || 'FAIL modify'::text; end if;

  -- ---- pending -> posted ----
  update plaid_transactions set excluded = true where id = 'p1';
  perform apply_plaid_sync_page(a, 'item-a',
    '[{"id":"s1","plaid_account_id":"pa1","date":"2026-06-12","name":"LOVES","amount":8000,"pending":false,"pending_transaction_id":"p1"}]', '[]', '["p1"]');
  if pg_temp.st('p1') = 'superseded>s1' and pg_temp.st('s1') = 'active' and (select excluded from plaid_transactions where id = 's1')
     and not (select excluded from plaid_transactions where id = 'p1')
  then results := results || 'PASS pending->posted: one transaction, excluded decision moved to posted row, pending kept as history'::text;
  else failures := failures || ('FAIL pending->posted ' || pg_temp.st('p1') || '/' || pg_temp.st('s1')); end if;
  if (select count(*) from plaid_transactions where user_id = a and status = 'active' and not pending) = 1
  then results := results || 'PASS exactly one active row for the real-world transaction'::text; else failures := failures || 'FAIL duplicate active rows'::text; end if;

  perform apply_plaid_sync_page(a, 'item-a',
    '[{"id":"s2","plaid_account_id":"pa1","date":"2026-06-12","name":"SHELL","amount":3100,"pending":false,"pending_transaction_id":"p2"}]', '[]', '["p2"]');
  if pg_temp.st('p2') = 'superseded>s2' and pg_temp.st('s2') = 'active'
  then results := results || 'PASS a second pending->posted pair (amount unchanged) also resolves to one row'::text;
  else failures := failures || 'FAIL second pair'::text; end if;

  -- ---- removal / late posting ----
  perform apply_plaid_sync_page(a, 'item-a', '[{"id":"p3","plaid_account_id":"pa1","date":"2026-06-13","name":"DINER","amount":900,"pending":true}]', '[]', '[]');
  update plaid_transactions set review_state = 'unsure', review_note = 'ask accountant' where id = 'p3';
  perform apply_plaid_sync_page(a, 'item-a', '[]', '[]', '["p3"]');
  if pg_temp.st('p3') = 'removed' then results := results || 'PASS a removed transaction is marked removed, not deleted'::text; else failures := failures || ('FAIL removed ' || pg_temp.st('p3')); end if;
  perform apply_plaid_sync_page(a, 'item-a', '[{"id":"s3","plaid_account_id":"pa1","date":"2026-06-13","name":"DINER","amount":950,"pending":false,"pending_transaction_id":"p3"}]', '[]', '[]');
  if pg_temp.st('p3') = 'superseded>s3' and (select review_state || '/' || review_note from plaid_transactions where id = 's3') = 'unsure/ask accountant'
  then results := results || 'PASS a posted row arriving after the pending row was removed still takes over its state'::text; else failures := failures || ('FAIL late post ' || pg_temp.st('p3')); end if;

  perform apply_plaid_sync_page(a, 'item-a', '[{"id":"p4","plaid_account_id":"pa1","date":"2026-06-14","name":"X","amount":100,"pending":true}]', '[]', '[]');
  perform apply_plaid_sync_page(a, 'item-a', '[{"id":"s4","plaid_account_id":"pa1","date":"2026-06-14","name":"X","amount":100,"pending":false,"pending_transaction_id":"p4"}]', '[]', '[]');
  if pg_temp.st('p4') = 'superseded>s4' then results := results || 'PASS posted-with-pending-id supersedes even with no removal in the page'::text; else failures := failures || ('FAIL supersede alone ' || pg_temp.st('p4')); end if;
  perform apply_plaid_sync_page(a, 'item-a', '[]', '[]', '["p4"]');
  if pg_temp.st('p4') = 'superseded>s4' and pg_temp.st('s4') = 'active' then results := results || 'PASS a late removal of an already-superseded row changes nothing'::text; else failures := failures || 'FAIL late removal'::text; end if;
  perform apply_plaid_sync_page(a, 'item-a', '[]', '[]', '["nope"]');
  results := results || 'PASS removing an unknown id is ignored'::text;
  perform apply_plaid_sync_page(a, 'item-a', '[{"id":"p3","plaid_account_id":"pa1","date":"2026-06-13","name":"DINER","amount":900,"pending":true}]', '[]', '[]');
  if pg_temp.st('p3') = 'superseded>s3' then results := results || 'PASS a superseded row stays superseded if the bank re-sends it'::text; else failures := failures || 'FAIL resurrect superseded'::text; end if;
  perform apply_plaid_sync_page(a, 'item-a', '[{"id":"p5","plaid_account_id":"pa1","date":"2026-06-15","name":"Y","amount":100,"pending":true}]', '[]', '["p5"]');
  if pg_temp.st('p5') = 'removed' then results := results || 'PASS added and removed in one page ends removed'::text; else failures := failures || 'FAIL add+remove'::text; end if;
  perform apply_plaid_sync_page(a, 'item-a', '[{"id":"p5","plaid_account_id":"pa1","date":"2026-06-15","name":"Y","amount":100,"pending":true}]', '[]', '[]');
  if pg_temp.st('p5') = 'active' then results := results || 'PASS a removed transaction the bank sends again becomes active again'::text; else failures := failures || 'FAIL re-add'::text; end if;

  -- ---- rejected pages ----
  select count(*) into n from plaid_transactions;
  begin perform apply_plaid_sync_page(a, 'item-a', '[{"id":"zz1","plaid_account_id":"pa1","date":"2026-06-15","name":"Z","amount":1,"pending":false},{"id":"zz2","plaid_account_id":"pa1","date":"bad-date","name":"Z","amount":1,"pending":false}]', '[]', '[]');
    failures := failures || 'FAIL bad page accepted';
  exception when others then
    if (select count(*) from plaid_transactions) = n then results := results || 'PASS a page with one bad row writes nothing (atomic)'::text; else failures := failures || 'FAIL partial page'::text; end if;
  end;
  begin perform apply_plaid_sync_page(a, 'item-b', '[]', '[]', '[]'); failures := failures || 'FAIL used another user''s connection';
  exception when others then if sqlstate = '42501' then results := results || 'PASS a page cannot be written to another user''s bank connection'::text; else failures := failures || ('FAIL foreign item ' || sqlstate); end if; end;
  perform apply_plaid_sync_page(b, 'item-b', '[{"id":"bx1","plaid_account_id":"pab","date":"2026-06-10","name":"B","amount":500,"pending":false}]', '[]', '[]');
  begin perform apply_plaid_sync_page(a, 'item-a', '[{"id":"bx1","plaid_account_id":"pa1","date":"2026-06-10","name":"HIJACK","amount":1,"pending":false}]', '[]', '[]');
    failures := failures || 'FAIL took another user''s transaction id';
  exception when others then
    if sqlstate = '23505' and (select name from plaid_transactions where id = 'bx1') = 'B' then results := results || 'PASS a transaction id owned by another user cannot be overwritten'::text; else failures := failures || ('FAIL id hijack ' || sqlstate); end if;
  end;
  begin perform apply_plaid_sync_page(a, 'item-a2', '[{"id":"p1","plaid_account_id":"pa9","date":"2026-06-10","name":"MOVED","amount":1,"pending":false}]', '[]', '[]');
    failures := failures || 'FAIL moved a transaction to another connection';
  exception when others then if sqlstate = '23505' then results := results || 'PASS a transaction cannot be silently moved to a different bank connection'::text; else failures := failures || ('FAIL moved ' || sqlstate); end if; end;

  -- ---- direct writes are closed for app users ----
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  for t in select * from (values
    ('INSERT plaid_transactions', 'insert into plaid_transactions (id,user_id,plaid_item_id,plaid_account_id,date,name,amount) values (''hx'', auth.uid(), ''item-a'', ''pa1'', ''2026-06-10'', ''x'', 1)'),
    ('UPDATE plaid_transactions (review state)', 'update plaid_transactions set review_state = ''unsure'' where id = ''s1'''),
    ('INSERT bank_matches (link to anything)', 'insert into bank_matches (user_id, plaid_transaction_id, kind, expense_id) values (auth.uid(), ''s1'', ''expense'', ''ex1'')'),
    ('UPDATE plaid_transactions (excluded flag)', 'update plaid_transactions set excluded = true'),
    ('UPDATE plaid_transactions (amount)', 'update plaid_transactions set amount = 1'),
    ('DELETE plaid_transactions', 'delete from plaid_transactions'),
    ('TRUNCATE plaid_transactions', 'truncate plaid_transactions'),
    ('INSERT bank_accounts', 'insert into bank_accounts (id,user_id,name,balance) values (''hb'', auth.uid(), ''x'', 0)'),
    ('UPDATE bank_accounts (re-point the Plaid account)', 'update bank_accounts set plaid_account_id = ''pab'''),
    ('UPDATE bank_accounts (balance)', 'update bank_accounts set balance = 999'),
    ('DELETE bank_accounts', 'delete from bank_accounts'),
    ('call apply_plaid_sync_page', 'select apply_plaid_sync_page(auth.uid(), ''item-a'', ''[]'', ''[]'', ''[]'')')
  ) as v(label, s)
  loop
    begin execute t.s; failures := failures || ('FAIL accepted: ' || t.label);
    exception when others then
      if sqlstate = '42501' then results := results || ('PASS rejected: ' || t.label); else failures := failures || ('FAIL ' || t.label || ' -> ' || sqlstate || ' ' || sqlerrm); end if;
    end;
  end loop;
  select count(*) into n from plaid_transactions where user_id = a and status = 'active';
  if n >= 1 and (select count(*) from plaid_transactions where user_id = b) = 0 then results := results || 'PASS users still read their own feed and nobody else''s'::text; else failures := failures || 'FAIL feed read'::text; end if;

  -- ---- exclude / restore ----
  perform exclude_bank_transaction('p5');
  if (select excluded from plaid_transactions where id = 'p5') then results := results || 'PASS exclude_bank_transaction'::text; else failures := failures || 'FAIL exclude'::text; end if;
  perform restore_bank_transaction('p5');
  if not (select excluded from plaid_transactions where id = 'p5') then results := results || 'PASS restore_bank_transaction'::text; else failures := failures || 'FAIL restore'::text; end if;
  for t in select * from (values
    ('exclude a removed transaction', '23514', 'select exclude_bank_transaction(''p3'')'),
    ('exclude an unknown transaction', 'P0002', 'select exclude_bank_transaction(''nope'')'),
    ('exclude another user''s transaction', 'P0002', 'select exclude_bank_transaction(''bx1'')'),
    ('restore another user''s transaction', 'P0002', 'select restore_bank_transaction(''bx1'')')
  ) as v(label, code, s)
  loop
    begin execute t.s; failures := failures || ('FAIL accepted: ' || t.label);
    exception when others then
      if sqlstate = t.code then results := results || ('PASS rejected: ' || t.label); else failures := failures || ('FAIL ' || t.label || ' -> ' || sqlstate || ' ' || sqlerrm); end if;
    end;
  end loop;
  reset role;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  begin perform exclude_bank_transaction('p5'); failures := failures || 'FAIL anon';
  exception when insufficient_privilege then results := results || 'PASS anon cannot exclude'::text; end;
  begin perform 1 from plaid_transactions; failures := failures || 'FAIL anon read';
  exception when insufficient_privilege then results := results || 'PASS anon cannot read the feed'::text; end;
  reset role;
  if has_function_privilege('service_role', 'public.apply_plaid_sync_page(uuid,text,jsonb,jsonb,jsonb)', 'execute')
     and not has_function_privilege('authenticated', 'public.apply_plaid_sync_page(uuid,text,jsonb,jsonb,jsonb)', 'execute')
     and not has_function_privilege('anon', 'public.apply_plaid_sync_page(uuid,text,jsonb,jsonb,jsonb)', 'execute')
  then results := results || 'PASS only the server (service role) can run the sync write'::text; else failures := failures || 'FAIL sync privileges'::text; end if;

  -- ---- the privileged role can clear a feed that contains superseded links (deferred self-reference) ----
  begin
    delete from plaid_transactions where user_id = a;
    set constraints all immediate;
    select count(*) into n from plaid_transactions where user_id = a;
    if n = 0 then results := results || 'PASS a whole feed with superseded links can be deleted in one statement'::text; else failures := failures || 'FAIL feed delete left rows'::text; end if;
  exception when others then failures := failures || ('FAIL feed delete: ' || sqlerrm); end;

  if array_length(failures,1) is null then
    raise exception 'ROLLED BACK - ALL PASS (% checks)', array_length(results,1);
  else
    raise exception 'ROLLED BACK - % FAILURES: %', array_length(failures,1), array_to_string(failures,' | ');
  end if;
end
$test$;
