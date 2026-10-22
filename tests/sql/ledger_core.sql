-- Stage B ledger-core tests: invariants 1-5 against the raw tables (privileged role, so only the
-- database's own triggers/constraints are in the way), plus privilege checks for app roles.
-- Runs in one DO block and always rolls back. Success = message starts 'ROLLED BACK - ALL PASS'.
do $test$
declare
  a uuid := '00000000-0000-4000-8000-0000000000aa';
  b uuid := '00000000-0000-4000-8000-0000000000bb';
  c uuid := '00000000-0000-4000-8000-0000000000cc';
  a_ar uuid; a_inc uuid; b_ar uuid;
  results text[] := '{}'; failures text[] := '{}';
  t record; stmt text; n int;
  ent text := $e$insert into journal_entries (id,user_id,entry_date,source_type,source_id,reverses_entry_id) values ('%s','%s','%s','%s',%s,%s);$e$;
begin
  insert into auth.users (id,email,aud,role) values
    (a,'ta@example.invalid','authenticated','authenticated'),
    (b,'tb@example.invalid','authenticated','authenticated'),
    (c,'tc@example.invalid','authenticated','authenticated');
  perform seed_chart_of_accounts(a); perform seed_chart_of_accounts(b); perform seed_chart_of_accounts(c);
  select id into a_ar  from accounts where user_id=a and system_key='accounts_receivable';
  select id into a_inc from accounts where user_id=a and system_key='income';
  select id into b_ar  from accounts where user_id=b and system_key='accounts_receivable';

  -- ---- Invariants 1,2,4: each statement must be rejected ----
  for t in select * from (values
    ('1 unbalanced entry',        '23514', 'values_unbalanced'),
    ('1 single-line entry',       '23514', 'values_single'),
    ('1 entry with no lines',     '23514', 'values_none'),
    ('2 line with debit AND credit','23514','values_both'),
    ('2 line with neither side',  '23514', 'values_zero'),
    ('2 negative debit',          '23514', 'values_negative'),
    ('4 line uses another user''s account','23503','values_xaccount'),
    ('4 line attached to another user''s entry','23503','values_xentry')
  ) as v(label, code, kind)
  loop
    stmt := format(ent, 'e0000000-0000-4000-8000-000000000001', a, '2026-06-01', 'manual', 'null', 'null');
    stmt := stmt || case t.kind
      when 'values_unbalanced' then format('insert into journal_lines (entry_id,user_id,account_id,debit_cents,credit_cents) values (%L,%L,%L,100,0),(%L,%L,%L,0,90);', 'e0000000-0000-4000-8000-000000000001', a, a_ar, 'e0000000-0000-4000-8000-000000000001', a, a_inc)
      when 'values_single'     then format('insert into journal_lines (entry_id,user_id,account_id,debit_cents,credit_cents) values (%L,%L,%L,100,0);', 'e0000000-0000-4000-8000-000000000001', a, a_ar)
      when 'values_none'       then ''
      when 'values_both'       then format('insert into journal_lines (entry_id,user_id,account_id,debit_cents,credit_cents) values (%L,%L,%L,100,100),(%L,%L,%L,0,100);', 'e0000000-0000-4000-8000-000000000001', a, a_ar, 'e0000000-0000-4000-8000-000000000001', a, a_inc)
      when 'values_zero'       then format('insert into journal_lines (entry_id,user_id,account_id,debit_cents,credit_cents) values (%L,%L,%L,0,0),(%L,%L,%L,0,100);', 'e0000000-0000-4000-8000-000000000001', a, a_ar, 'e0000000-0000-4000-8000-000000000001', a, a_inc)
      when 'values_negative'   then format('insert into journal_lines (entry_id,user_id,account_id,debit_cents,credit_cents) values (%L,%L,%L,-100,0),(%L,%L,%L,0,100);', 'e0000000-0000-4000-8000-000000000001', a, a_ar, 'e0000000-0000-4000-8000-000000000001', a, a_inc)
      when 'values_xaccount'   then format('insert into journal_lines (entry_id,user_id,account_id,debit_cents,credit_cents) values (%L,%L,%L,100,0),(%L,%L,%L,0,100);', 'e0000000-0000-4000-8000-000000000001', a, b_ar, 'e0000000-0000-4000-8000-000000000001', a, a_inc)
      when 'values_xentry'     then format('insert into journal_lines (entry_id,user_id,account_id,debit_cents,credit_cents) values (%L,%L,%L,100,0),(%L,%L,%L,0,100);', 'e0000000-0000-4000-8000-000000000001', b, a_ar, 'e0000000-0000-4000-8000-000000000001', b, a_inc)
    end || 'set constraints all immediate;';
    begin
      execute stmt;
      failures := failures || ('FAIL accepted: ' || t.label);
    exception when others then
      if sqlstate = t.code then results := results || ('PASS rejected: ' || t.label);
      else failures := failures || ('FAIL ' || t.label || ' wrong error ' || sqlstate || ': ' || sqlerrm); end if;
    end;
    set constraints all deferred;
  end loop;

  -- ---- Positive control: a balanced two-line entry is accepted ----
  begin
    insert into journal_entries (id,user_id,entry_date,source_type,source_id) values ('e0000000-0000-4000-8000-0000000000e1',a,'2026-06-01','invoice','inv-1');
    insert into journal_lines (entry_id,user_id,account_id,debit_cents,credit_cents) values
      ('e0000000-0000-4000-8000-0000000000e1',a,a_ar,10000,0),('e0000000-0000-4000-8000-0000000000e1',a,a_inc,0,10000);
    set constraints all immediate;
    results := results || 'PASS balanced entry accepted'::text;
  exception when others then failures := failures || ('FAIL balanced entry rejected: ' || sqlerrm);
  end;
  set constraints all deferred;

  -- ---- Invariant 3: immutability ----
  for t in select * from (values
    ('update a line',     'update journal_lines set debit_cents = 5 where entry_id = ''e0000000-0000-4000-8000-0000000000e1'' and debit_cents > 0'),
    ('delete a line',     'delete from journal_lines where entry_id = ''e0000000-0000-4000-8000-0000000000e1'''),
    ('update an entry',   'update journal_entries set memo = ''x'' where id = ''e0000000-0000-4000-8000-0000000000e1'''),
    ('delete an entry',   'delete from journal_entries where id = ''e0000000-0000-4000-8000-0000000000e1'''),
    ('truncate lines',    'truncate journal_lines'),
    ('truncate entries',  'truncate journal_entries cascade')
  ) as v(label, s)
  loop
    begin
      execute t.s;
      failures := failures || ('FAIL allowed: ' || t.label);
    exception when others then
      if sqlstate = '23514' then results := results || ('PASS blocked: ' || t.label);
      else failures := failures || ('FAIL ' || t.label || ' wrong error ' || sqlstate || ': ' || sqlerrm); end if;
    end;
  end loop;

  -- A balanced pair can't be slipped into an entry posted by an earlier transaction.
  begin
    set local session_replication_role = replica;
    update journal_entries set txid = '1'::xid8 where id = 'e0000000-0000-4000-8000-0000000000e1';
    set local session_replication_role = origin;
    insert into journal_lines (entry_id,user_id,account_id,debit_cents,credit_cents) values
      ('e0000000-0000-4000-8000-0000000000e1',a,a_ar,50,0),('e0000000-0000-4000-8000-0000000000e1',a,a_inc,0,50);
    failures := failures || 'FAIL lines added to an old entry';
  exception when others then
    set local session_replication_role = origin;
    if sqlstate = '23514' then results := results || 'PASS cannot add lines to an already-posted entry'::text;
    else failures := failures || ('FAIL old-entry guard wrong error ' || sqlstate || ': ' || sqlerrm); end if;
  end;

  -- ---- Invariant 5: reversal rules + no double posting ----
  insert into journal_entries (id,user_id,entry_date,source_type,source_id) values ('e0000000-0000-4000-8000-0000000000e2',a,'2026-06-02','bank_transaction','man-1');
  insert into journal_lines (entry_id,user_id,account_id,debit_cents,credit_cents) values
    ('e0000000-0000-4000-8000-0000000000e2',a,a_ar,700,0),('e0000000-0000-4000-8000-0000000000e2',a,a_inc,0,700);
  set constraints all immediate; set constraints all deferred;

  for t in select * from (values
    ('reversal with wrong amount', '23514',
      $q$insert into journal_entries (id,user_id,entry_date,source_type,source_id,reverses_entry_id) values ('e0000000-0000-4000-8000-0000000000f2','00000000-0000-4000-8000-0000000000aa','2026-06-02','bank_transaction','man-1','e0000000-0000-4000-8000-0000000000e2');
         insert into journal_lines (entry_id,user_id,account_id,debit_cents,credit_cents) select 'e0000000-0000-4000-8000-0000000000f2'::uuid,user_id,account_id,case when credit_cents>0 then 600 else 0 end,case when debit_cents>0 then 600 else 0 end from journal_lines where entry_id='e0000000-0000-4000-8000-0000000000e2'$q$),
    ('reversal with same sides (not swapped)', '23514',
      $q$insert into journal_entries (id,user_id,entry_date,source_type,source_id,reverses_entry_id) values ('e0000000-0000-4000-8000-0000000000f3','00000000-0000-4000-8000-0000000000aa','2026-06-02','bank_transaction','man-1','e0000000-0000-4000-8000-0000000000e2');
         insert into journal_lines (entry_id,user_id,account_id,debit_cents,credit_cents) select 'e0000000-0000-4000-8000-0000000000f3',user_id,account_id,debit_cents,credit_cents from journal_lines where entry_id='e0000000-0000-4000-8000-0000000000e2'$q$),
    ('reversal on a different date', '23514',
      $q$insert into journal_entries (id,user_id,entry_date,source_type,source_id,reverses_entry_id) values ('e0000000-0000-4000-8000-0000000000f4','00000000-0000-4000-8000-0000000000aa','2026-06-09','bank_transaction','man-1','e0000000-0000-4000-8000-0000000000e2');
         insert into journal_lines (entry_id,user_id,account_id,debit_cents,credit_cents) select 'e0000000-0000-4000-8000-0000000000f4',user_id,account_id,credit_cents,debit_cents from journal_lines where entry_id='e0000000-0000-4000-8000-0000000000e2'$q$),
    ('reversal with a different source', '23514',
      $q$insert into journal_entries (id,user_id,entry_date,source_type,source_id,reverses_entry_id) values ('e0000000-0000-4000-8000-0000000000f5','00000000-0000-4000-8000-0000000000aa','2026-06-02','bank_transaction','man-OTHER','e0000000-0000-4000-8000-0000000000e2');
         insert into journal_lines (entry_id,user_id,account_id,debit_cents,credit_cents) select 'e0000000-0000-4000-8000-0000000000f5',user_id,account_id,credit_cents,debit_cents from journal_lines where entry_id='e0000000-0000-4000-8000-0000000000e2'$q$),
    ('exact reversal accepted', 'ok',
      $q$insert into journal_entries (id,user_id,entry_date,source_type,source_id,reverses_entry_id) values ('e0000000-0000-4000-8000-0000000000f1','00000000-0000-4000-8000-0000000000aa','2026-06-02','bank_transaction','man-1','e0000000-0000-4000-8000-0000000000e2');
         insert into journal_lines (entry_id,user_id,account_id,debit_cents,credit_cents) select 'e0000000-0000-4000-8000-0000000000f1',user_id,account_id,credit_cents,debit_cents from journal_lines where entry_id='e0000000-0000-4000-8000-0000000000e2'$q$),
    ('reversing a reversal', '23514',
      $q$insert into journal_entries (id,user_id,entry_date,source_type,source_id,reverses_entry_id) values ('e0000000-0000-4000-8000-0000000000f6','00000000-0000-4000-8000-0000000000aa','2026-06-02','bank_transaction','man-1','e0000000-0000-4000-8000-0000000000f1');
         insert into journal_lines (entry_id,user_id,account_id,debit_cents,credit_cents) select 'e0000000-0000-4000-8000-0000000000f6',user_id,account_id,credit_cents,debit_cents from journal_lines where entry_id='e0000000-0000-4000-8000-0000000000f1'$q$),
    ('reversing the same entry twice', '23505',
      $q$insert into journal_entries (id,user_id,entry_date,source_type,source_id,reverses_entry_id) values ('e0000000-0000-4000-8000-0000000000f7','00000000-0000-4000-8000-0000000000aa','2026-06-02','bank_transaction','man-1','e0000000-0000-4000-8000-0000000000e2');
         insert into journal_lines (entry_id,user_id,account_id,debit_cents,credit_cents) select 'e0000000-0000-4000-8000-0000000000f7',user_id,account_id,credit_cents,debit_cents from journal_lines where entry_id='e0000000-0000-4000-8000-0000000000e2'$q$)
  ) as v(label, code, s)
  loop
    begin
      execute t.s || '; set constraints all immediate;';
      if t.code = 'ok' then results := results || ('PASS ' || t.label);
      else failures := failures || ('FAIL accepted: ' || t.label); end if;
    exception when others then
      if t.code <> 'ok' and sqlstate = t.code then results := results || ('PASS rejected: ' || t.label);
      else failures := failures || ('FAIL ' || t.label || ' -> ' || sqlstate || ': ' || sqlerrm); end if;
    end;
    set constraints all deferred;
  end loop;

  -- Replacement after reversal is allowed; a second ACTIVE entry for the same source is not.
  begin
    insert into journal_entries (id,user_id,entry_date,source_type,source_id) values ('e0000000-0000-4000-8000-0000000000a1',a,'2026-06-02','bank_transaction','man-1');
    insert into journal_lines (entry_id,user_id,account_id,debit_cents,credit_cents) values
      ('e0000000-0000-4000-8000-0000000000a1',a,a_ar,800,0),('e0000000-0000-4000-8000-0000000000a1',a,a_inc,0,800);
    set constraints all immediate;
    results := results || 'PASS replacement entry allowed after reversal'::text;
  exception when others then failures := failures || ('FAIL replacement after reversal: ' || sqlerrm);
  end;
  set constraints all deferred;
  begin
    insert into journal_entries (id,user_id,entry_date,source_type,source_id) values ('e0000000-0000-4000-8000-0000000000a2',a,'2026-06-02','bank_transaction','man-1');
    insert into journal_lines (entry_id,user_id,account_id,debit_cents,credit_cents) values
      ('e0000000-0000-4000-8000-0000000000a2',a,a_ar,800,0),('e0000000-0000-4000-8000-0000000000a2',a,a_inc,0,800);
    set constraints all immediate;
    failures := failures || 'FAIL second active entry for one source accepted'::text;
  exception when others then
    if sqlstate = '23505' then results := results || 'PASS second active entry for one source rejected'::text;
    else failures := failures || ('FAIL double-post wrong error ' || sqlstate || ': ' || sqlerrm); end if;
  end;
  set constraints all deferred;

  -- ---- Account guards ----
  begin delete from accounts where id = a_ar; failures := failures || 'FAIL deleted system account';
  exception when others then if sqlstate='23514' then results := results || 'PASS system account cannot be deleted'::text; else failures := failures || ('FAIL sys delete '||sqlstate||sqlerrm); end if; end;
  begin update accounts set name = 'Hacked' where id = a_ar; failures := failures || 'FAIL renamed system account';
  exception when others then if sqlstate='23514' then results := results || 'PASS system account cannot be renamed'::text; else failures := failures || ('FAIL sys rename '||sqlstate||sqlerrm); end if; end;
  begin update accounts set type = 'expense' where id = a_inc; failures := failures || 'FAIL changed account type';
  exception when others then if sqlstate='23514' then results := results || 'PASS account type cannot change'::text; else failures := failures || ('FAIL type change '||sqlstate||sqlerrm); end if; end;

  -- ---- App roles can't write the ledger or call internals; can only read their own ----
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  for t in select * from (values
    ('authenticated INSERT journal_entries', 'insert into journal_entries (user_id,entry_date,source_type,source_id) values (auth.uid(), ''2026-06-01'', ''expense'', ''z'')'),
    ('authenticated INSERT journal_lines',   'insert into journal_lines (entry_id,user_id,account_id,debit_cents) values (gen_random_uuid(), auth.uid(), gen_random_uuid(), 1)'),
    ('authenticated INSERT accounts',        'insert into accounts (user_id,name,type) values (auth.uid(), ''Mine'', ''asset'')'),
    ('authenticated UPDATE accounts',        'update accounts set is_active = false'),
    ('authenticated DELETE journal_lines',   'delete from journal_lines'),
    ('authenticated call seed_chart_of_accounts', 'select seed_chart_of_accounts(auth.uid())'),
    ('authenticated call validate/internal', 'select validate_journal_entry(gen_random_uuid())')
  ) as v(label, s)
  loop
    begin
      execute t.s;
      failures := failures || ('FAIL allowed: ' || t.label);
    exception when insufficient_privilege then results := results || ('PASS denied: ' || t.label);
    when others then failures := failures || ('FAIL ' || t.label || ' wrong error ' || sqlstate || ': ' || sqlerrm);
    end;
  end loop;
  select count(*) into n from journal_entries where user_id = b;
  if n = 0 then results := results || 'PASS A cannot read B journal entries'::text; else failures := failures || 'FAIL A reads B entries'; end if;
  select count(*) into n from accounts where user_id = b;
  if n = 0 then results := results || 'PASS A cannot read B accounts'::text; else failures := failures || 'FAIL A reads B accounts'; end if;
  select count(*) into n from account_balances where user_id = b;
  if n = 0 then results := results || 'PASS A cannot read B balances view'::text; else failures := failures || 'FAIL A reads B balances'; end if;
  select count(*) into n from journal_entries where user_id = a;
  if n > 0 then results := results || 'PASS A can read own journal entries'::text; else failures := failures || 'FAIL A cannot read own entries'; end if;
  reset role;

  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  begin perform 1 from accounts; failures := failures || 'FAIL anon read accounts';
  exception when insufficient_privilege then results := results || 'PASS anon denied accounts'::text; end;
  begin perform 1 from journal_lines; failures := failures || 'FAIL anon read lines';
  exception when insufficient_privilege then results := results || 'PASS anon denied journal_lines'::text; end;
  begin perform ensure_chart_of_accounts(); failures := failures || 'FAIL anon ran ensure_chart';
  exception when insufficient_privilege then results := results || 'PASS anon cannot execute ensure_chart_of_accounts'::text; end;
  reset role;

  -- ---- Deleting a user still works despite immutable ledger (cascade exception) ----
  begin
    insert into journal_entries (id,user_id,entry_date,source_type,source_id) values ('e0000000-0000-4000-8000-0000000000c1',c,'2026-06-01','invoice','c-1');
    insert into journal_lines (entry_id,user_id,account_id,debit_cents,credit_cents)
      select 'e0000000-0000-4000-8000-0000000000c1', c, id, case when system_key='accounts_receivable' then 5 else 0 end, case when system_key='income' then 5 else 0 end
      from accounts where user_id = c and system_key in ('accounts_receivable','income');
    set constraints all immediate; set constraints all deferred;
    delete from auth.users where id = c;
    select count(*) into n from journal_entries where user_id = c;
    select n + count(*) into n from accounts where user_id = c;
    if n = 0 then results := results || 'PASS deleting a user cascades through the immutable ledger'::text;
    else failures := failures || 'FAIL user delete left ledger rows'; end if;
  exception when others then failures := failures || ('FAIL user delete: ' || sqlerrm);
  end;

  if array_length(failures,1) is null then
    raise exception 'ROLLED BACK - ALL PASS (% checks): %', array_length(results,1), array_to_string(results,' | ');
  else
    raise exception 'ROLLED BACK - % FAILURES: % || PASSED: %', array_length(failures,1), array_to_string(failures,' | '), array_to_string(results,' | ');
  end if;
end
$test$;
