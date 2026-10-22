-- Stage F3 tests: reconciliation diagnoses the difference between the books and the bank and NEVER posts anything.
-- One DO block, always rolls back. Success = message starts 'ROLLED BACK - ALL PASS'.
do $test$
declare
  a uuid := '00000000-0000-4000-8000-0000000000aa';
  b uuid := '00000000-0000-4000-8000-0000000000bb';
  chk uuid; sav uuid; card uuid; pay uuid; n int; n2 int; r record; tid uuid;
  results text[] := '{}'; failures text[] := '{}';
begin
  insert into auth.users (id,email,aud,role) values (a,'ta@example.invalid','authenticated','authenticated'),(b,'tb@example.invalid','authenticated','authenticated');
  insert into plaid_items (id,user_id,item_id,access_token) values ('pi-a',a,'item-a','x'),('pi-b',b,'item-b','x');
  insert into bank_accounts (id,user_id,name,last4,balance,last_updated,subtype,plaid_item_id,plaid_account_id) values
    ('bk1',a,'Checking','1111',69300,'today',null,'item-a','pa1'),('bk2',a,'Savings','2222',0,'today',null,'item-a','pa2'),
    ('bk3',a,'Visa','3333',4000,'today','credit card','item-a','pa3'),('bk4',a,'Manual','4444',0,'x',null,null,null),
    ('bkb',b,'B Checking','9999',500,'today',null,'item-b','pab');
  insert into expense_categories (user_id,name) values (a,'Fuel'),(b,'Fuel');
  insert into customers (id,user_id,name) values ('c1',a,'ACME');
  perform seed_chart_of_accounts(a); perform seed_chart_of_accounts(b);
  select id into chk from accounts where bank_account_id='bk1'; select id into sav from accounts where bank_account_id='bk2'; select id into card from accounts where bank_account_id='bk3';
  insert into plaid_transactions (id,user_id,plaid_item_id,plaid_account_id,date,name,amount,pending) values
    ('r0',a,'item-a','pa1','2026-05-20','BEFORE START',1234,false),
    ('r1',a,'item-a','pa1','2026-06-05','CUSTOMER DEPOSIT',-30000,false),
    ('r2',a,'item-a','pa1','2026-06-06','VENDOR',8000,false),
    ('r3',a,'item-a','pa1','2026-06-07','IGNORED',2000,false),
    ('r4',a,'item-a','pa1','2026-06-08','PENDING',500,true),
    ('r5',a,'item-a','pa1','2026-06-09','FUEL',700,false),
    ('c1',a,'item-a','pa3','2026-06-10','CARD BUY',3000,false),
    ('tb1',b,'item-b','pab','2026-06-11','B',1000,false);
  update plaid_transactions set excluded = true where id = 'r3';
  execute 'create function pg_temp.ra(i uuid) returns public.reconciliation_accounts language sql as $f$ select * from public.reconciliation_accounts where account_id = i $f$';

  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform set_opening_balance(chk, 50000, '2026-05-31');
  perform set_opening_balance(card, 1000, '2026-05-31');
  pay := record_payment('c1', '2026-06-05', 30000, chk, '[]'::jsonb, 'check', null, null);
  perform match_bank_transaction('r1', 'payment', pay::text);
  perform save_expense(jsonb_build_object('id','x1','date','2026-06-09','vendor','Loves','category','Fuel','amount',700,'notes',null), chk);
  perform save_expense(jsonb_build_object('id','x2','date','2026-06-09','vendor','Oops','category','Fuel','amount',99,'notes',null), chk);
  perform delete_expense('x2');
  perform record_transfer('2026-06-12', 1500, chk, sav, null);

  select count(*) into n from journal_entries;
  select * into r from pg_temp.ra(chk);
  if r.status = 'explained_by_open_items' and r.books_balance_cents = 77800 and r.bank_balance_cents = 69300 and r.difference_cents = 8500
     and r.explained_cents = 8500 and r.unexplained_cents = 0
  then results := results || 'PASS checking: books 778.00 vs bank 693.00 - the 85.00 difference is fully explained by listed items'::text; else failures := failures || ('FAIL checking summary ' || r::text); end if;
  if r.unrecorded_count = 2 and r.unrecorded_cents = -8700 and r.ignored_count = 1 and r.ignored_cents = -2000 and r.unlinked_count = 2 and r.unlinked_cents = -2200
  then results := results || 'PASS the pieces: 2 unrecorded bank transactions, 1 ignored, 2 recorded items with no bank transaction'::text; else failures := failures || ('FAIL checking pieces ' || r::text); end if;
  if r.pending_count = 1 and r.pending_cents = -500 and r.before_start_count = 1
  then results := results || 'PASS pending and before-starting-date transactions are shown but kept out of the equation'::text; else failures := failures || 'FAIL pending / before start'::text; end if;
  select * into r from pg_temp.ra(card);
  if r.account_type = 'liability' and r.status = 'explained_by_open_items' and r.difference_cents = -3000 and r.unrecorded_cents = 3000 and r.unexplained_cents = 0
  then results := results || 'PASS credit card: amount owed compared with the same sign convention (a purchase raises what you owe)'::text; else failures := failures || ('FAIL card ' || r::text); end if;
  select * into r from pg_temp.ra(sav);
  if r.status = 'needs_starting_balance' and r.unexplained_cents is null
  then results := results || 'PASS no starting balance: reconciliation says so instead of claiming a difference'::text; else failures := failures || ('FAIL no starting balance ' || r::text); end if;
  if (select count(*) from reconciliation_accounts) = 3 then results := results || 'PASS only connected bank/card accounts are reconciled (manual accounts have nothing to compare to)'::text; else failures := failures || 'FAIL account set'::text; end if;

  if exists (select 1 from reconciliation_unlinked_items where account_id = chk and source_type = 'expense' and source_id = 'x1' and effect_cents = -700 and after_start)
     and exists (select 1 from reconciliation_unlinked_items where account_id = chk and source_type = 'transfer' and effect_cents = -1500)
     and exists (select 1 from reconciliation_unlinked_items where account_id = sav and source_type = 'transfer' and effect_cents = 1500)
  then results := results || 'PASS recorded items with no bank transaction are listed per account (a transfer shows on both sides)'::text; else failures := failures || 'FAIL unlinked list'::text; end if;
  if not exists (select 1 from reconciliation_unlinked_items where source_id = 'x2') and not exists (select 1 from reconciliation_unlinked_items where source_type = 'payment')
  then results := results || 'PASS a deleted expense (entry + reversal) and a payment matched to its deposit are not listed'::text; else failures := failures || 'FAIL unlinked noise'::text; end if;

  -- a wrong bank balance is reported as UNEXPLAINED, never plugged
  reset role;
  update bank_accounts set balance = 70500 where id = 'bk1';
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select * into r from pg_temp.ra(chk);
  if r.status = 'unexplained' and r.difference_cents = 7300 and r.unexplained_cents = -1200
  then results := results || 'PASS a bank balance that does not fit is reported as unexplained (-12.00), with nothing adjusted'::text; else failures := failures || ('FAIL unexplained ' || r::text); end if;
  reset role;
  update bank_accounts set balance = 69300 where id = 'bk1';
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- reading never writes
  select count(*) into n2 from journal_entries;
  perform count(*) from reconciliation_accounts; perform count(*) from reconciliation_unlinked_items;
  if (select count(*) from journal_entries) = n2 and n2 = n then results := results || 'PASS reconciliation created no journal entries and no adjustments'::text; else failures := failures || 'FAIL reconciliation wrote entries'::text; end if;

  -- working the list down changes WHAT explains the difference, not the difference
  perform match_bank_transaction('r5', 'expense', 'x1');
  select * into r from pg_temp.ra(chk);
  if r.difference_cents = 8500 and r.unlinked_count = 1 and r.unrecorded_count = 1 and r.unexplained_cents = 0
  then results := results || 'PASS matching a bank transaction to the expense you already entered moves 7.00 out of both lists, difference unchanged'::text; else failures := failures || ('FAIL after match ' || r::text); end if;
  perform restore_bank_transaction('r3');
  perform resolve_bank_transaction('r2', 'expense', '{"category":"Fuel","confirm_new":true}');
  perform resolve_bank_transaction('r3', 'owner_draw', '{"confirm_new":true}');
  select * into r from pg_temp.ra(chk);
  if r.unrecorded_count = 0 and r.ignored_count = 0 and r.books_balance_cents = 67800 and r.difference_cents = -1500 and r.unexplained_cents = 0 and r.status = 'explained_by_open_items'
  then results := results || 'PASS recording the rest leaves only the 15.00 transfer that has no bank transaction behind it, still explained'::text; else failures := failures || ('FAIL after record ' || r::text); end if;
  select id into tid from transfers limit 1;
  perform void_transfer(tid);
  select * into r from pg_temp.ra(chk);
  if r.status = 'agrees' and r.difference_cents = 0 and r.unlinked_count = 0 and r.unrecorded_count = 0 and r.ignored_count = 0
  then results := results || 'PASS once the books and the bank genuinely agree the status is "agrees"'::text; else failures := failures || ('FAIL agrees ' || r::text); end if;

  -- isolation
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  if (select count(*) from reconciliation_accounts where user_id = a) = 0 and (select count(*) from reconciliation_unlinked_items where user_id = a) = 0 and (select count(*) from reconciliation_accounts) = 1
  then results := results || 'PASS B sees only their own reconciliation'::text; else failures := failures || 'FAIL B reads'::text; end if;
  begin execute 'insert into reconciliation_accounts select * from reconciliation_accounts'; failures := failures || 'FAIL wrote a view'::text;
  exception when others then results := results || 'PASS the reconciliation views cannot be written'::text; end;
  reset role;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  begin perform 1 from reconciliation_accounts; failures := failures || 'FAIL anon read'::text;
  exception when insufficient_privilege then results := results || 'PASS anon cannot read reconciliation'::text; end;
  reset role;

  if array_length(failures,1) is null then
    raise exception 'ROLLED BACK - ALL PASS (% checks)', array_length(results,1);
  else
    raise exception 'ROLLED BACK - % FAILURES: %', array_length(failures,1), array_to_string(failures,' | ');
  end if;
end
$test$;
