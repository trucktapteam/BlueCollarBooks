-- Stage F5 tests: function privilege allowlist. Read-only; success = message starts 'ALL PASS'.
do $test$
declare
  r record; failures text[] := '{}'; n int := 0; s text;
  low text[] := array['post_expense(text,uuid)','repost_expense(text,uuid)','post_opening_balance(uuid,bigint,date)','reverse_journal_entry(uuid,text)','reverse_active_entry(text,text,text)','sync_invoice_posting(text)','ensure_chart_of_accounts()'];
  pub text[] := array['save_expense(jsonb,uuid)','delete_expense(text)','record_transfer(date,bigint,uuid,uuid,text)','void_transfer(uuid)','record_refund(date,bigint,uuid,text,text)','void_refund(uuid)',
                      'resolve_bank_transaction(text,text,jsonb)','match_bank_transaction(text,text,text,text)','undo_bank_resolution(text)','confirm_transfer_pair(text,text,text)','set_opening_balance(uuid,bigint,date)'];
begin
  -- 1. the seven low-level functions are not callable by signed-in or anonymous users
  foreach s in array low loop
    n := n + 1;
    if has_function_privilege('authenticated', 'public.' || s, 'execute') or has_function_privilege('anon', 'public.' || s, 'execute') then failures := failures || ('FAIL still executable: ' || s); end if;
  end loop;
  -- 2. workflow functions: signed-in yes, anonymous no
  foreach s in array pub loop
    n := n + 1;
    begin
      if not has_function_privilege('authenticated', 'public.' || s, 'execute') then failures := failures || ('FAIL authenticated cannot run ' || s); end if;
      if has_function_privilege('anon', 'public.' || s, 'execute') then failures := failures || ('FAIL anon can run ' || s); end if;
    exception when undefined_function then failures := failures || ('FAIL missing ' || s); end;
  end loop;
  -- 3. internal helpers (underscore-prefixed) and trigger functions are not exposed to API roles
  for r in select p.oid::regprocedure::text as sig from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
            where ns.nspname = 'public' and (p.proname like '\_%' or p.proname like '\_tg%')
              and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute')) loop
    n := n + 1; failures := failures || ('FAIL internal helper exposed: ' || r.sig);
  end loop;
  -- 4. no function in public is executable by anon
  for r in select p.oid::regprocedure::text as sig from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
            where ns.nspname = 'public' and p.prokind = 'f' and has_function_privilege('anon', p.oid, 'execute') loop
    n := n + 1; failures := failures || ('FAIL anon can execute ' || r.sig);
  end loop;
  -- 5. server-only function stays server-only
  n := n + 1;
  if exists (select 1 from pg_proc where proname = 'apply_plaid_sync_page' and (has_function_privilege('authenticated', oid, 'execute') or has_function_privilege('anon', oid, 'execute')))
  then failures := failures || 'FAIL apply_plaid_sync_page exposed to users'; end if;
  if array_length(failures,1) is null then raise exception 'ALL PASS (% groups checked)', n;
  else raise exception '% FAILURES: %', array_length(failures,1), array_to_string(failures,' | '); end if;
end
$test$;
