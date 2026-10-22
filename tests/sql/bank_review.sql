-- Stage F2 tests: resolving bank transactions (money out and in): match-first, transfer pairs, new events, undo, edit/void safety,
-- pending->posted links, removals, isolation, privileges. One DO block, always rolls back.
-- Success = message starts 'ROLLED BACK - ALL PASS'.
do $test$
declare
  a uuid := '00000000-0000-4000-8000-0000000000aa';
  b uuid := '00000000-0000-4000-8000-0000000000bb';
  chk uuid; sav uuid; card uuid; man uuid; fuel uuid; meals uuid; draws uuid; contrib uuid; inc uuid;
  n int; n2 int; n3 int; v bigint; v2 bigint; v3 bigint; t record; r record; tid uuid; lid uuid; pay uuid; e1 text; mid uuid; oid uuid;
  results text[] := '{}'; failures text[] := '{}';
begin
  insert into auth.users (id,email,aud,role) values (a,'ta@example.invalid','authenticated','authenticated'),(b,'tb@example.invalid','authenticated','authenticated');
  insert into plaid_items (id,user_id,item_id,access_token) values ('pi-a',a,'item-a','x'),('pi-b',b,'item-b','x');
  insert into bank_accounts (id,user_id,name,last4,balance,last_updated,subtype,plaid_item_id,plaid_account_id) values
    ('bk1',a,'Checking','1111',0,'x',null,'item-a','pa1'),('bk2',a,'Savings','2222',0,'x',null,'item-a','pa2'),
    ('bk3',a,'Visa','3333',0,'x','credit card','item-a','pa3'),('bk4',a,'Manual Savings','4444',0,'x',null,null,null),
    ('bkb',b,'B Checking','9999',0,'x',null,'item-b','pab');
  insert into expense_categories (user_id,name) values (a,'Fuel'),(a,'Meals'),(b,'Fuel');
  insert into customers (id,user_id,name) values ('c1',a,'ACME'),('cb',b,'B Co');
  perform seed_chart_of_accounts(a); perform seed_chart_of_accounts(b);
  select id into chk from accounts where bank_account_id='bk1'; select id into sav from accounts where bank_account_id='bk2';
  select id into card from accounts where bank_account_id='bk3'; select id into man from accounts where bank_account_id='bk4';
  select id into fuel from accounts where user_id=a and name='Fuel'; select id into meals from accounts where user_id=a and name='Meals';
  select id into draws from accounts where user_id=a and system_key='owner_draws'; select id into contrib from accounts where user_id=a and system_key='owner_contributions';
  select id into inc from accounts where user_id=a and system_key='income';
  insert into plaid_transactions (id,user_id,plaid_item_id,plaid_account_id,date,name,merchant_name,amount,pending) values
    ('o1',a,'item-a','pa1','2026-06-10','LOVES #1','Loves',8000,false),
    ('o2',a,'item-a','pa1','2026-06-12','DEPOSIT',null,-50000,false),
    ('o3',a,'item-a','pa1','2026-06-13','TO SAVINGS',null,20000,false),
    ('o3i',a,'item-a','pa2','2026-06-13','FROM CHECKING',null,-20000,false),
    ('o4',a,'item-a','pa1','2026-06-15','ATM OWNER',null,30000,false),
    ('o5',a,'item-a','pa1','2026-06-16','LOAN FUNDS',null,-100000,false),
    ('o6',a,'item-a','pa1','2026-06-17','LOAN PMT',null,40000,false),
    ('o7',a,'item-a','pa1','2026-06-18','OWNER IN',null,-7000,false),
    ('o8',a,'item-a','pa1','2026-06-19','VENDOR CREDIT',null,-2500,false),
    ('o9',a,'item-a','pa3','2026-06-14','DINER',null,2500,false),
    ('o10',a,'item-a','pa1','2026-06-20','VISA PMT',null,4500,false),
    ('o10i',a,'item-a','pa3','2026-06-20','PAYMENT THANK YOU',null,-4500,false),
    ('o11',a,'item-a','pa1','2026-06-21','TO MANUAL',null,9100,false),
    ('o12',a,'item-a','pa1','2026-06-22','FROM MANUAL',null,-3300,false),
    ('o13',a,'item-a','pa1','2026-06-24','AMB OUT 1',null,6000,false),
    ('o14',a,'item-a','pa1','2026-06-24','AMB OUT 2',null,6000,false),
    ('o14i',a,'item-a','pa2','2026-06-24','AMB IN',null,-6000,false),
    ('pend',a,'item-a','pa1','2026-06-23','PENDING',null,100,true),
    ('ox',a,'item-a','pa1','2026-06-25','EXCLUDED ONE',null,111,false),
    ('o15',a,'item-a','pa2','2026-06-24','ODD IN',null,-777,false),
    ('tb1',b,'item-b','pab','2026-06-11','B SHOP',null,1000,false);
  update plaid_transactions set excluded = true where id = 'ox';
  execute 'create function pg_temp.bal(p uuid) returns bigint language sql as $f$ select coalesce((select balance_cents from account_balances where account_id = p), 0) $f$';
  execute 'create function pg_temp.st(i text) returns text language sql as $f$ select state from bank_feed where id = i $f$';
  execute 'create function pg_temp.live(i text) returns int language sql as $f$ select count(*)::int from bank_matches where plaid_transaction_id = i and undone_at is null $f$';
  execute 'create function pg_temp.mt(i text) returns text language sql as $f$ select match_kind || coalesce('':'' || match_side, '''') from bank_feed where id = i $f$';

  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- things the user already recorded by hand
  perform save_expense(jsonb_build_object('id','e1','date','2026-06-11','vendor','Loves','category','Fuel','amount',8000,'notes',null), chk);
  perform save_expense(jsonb_build_object('id','e2','date','2026-06-11','vendor','Other','category','Fuel','amount',8100,'notes',null), chk);
  pay := record_payment('c1', '2026-06-11', 50000, chk, '[]'::jsonb, 'check', null, null);

  -- ---- state / suggestions ----
  if (select count(*) from bank_feed where state = 'needs_review') >= 15 and pg_temp.st('pend') = 'pending' and pg_temp.st('ox') = 'excluded'
  then results := results || 'PASS bank_feed shows open, pending and excluded states'::text; else failures := failures || 'FAIL feed states'::text; end if;
  if exists (select 1 from bank_match_candidates('o1') where kind = 'expense' and target_id = 'e1') and not exists (select 1 from bank_match_candidates('o1') where target_id = 'e2')
  then results := results || 'PASS money out: the matching expense you already entered is suggested (a different amount is not)'::text; else failures := failures || 'FAIL expense candidate'::text; end if;
  if exists (select 1 from bank_match_candidates('o2') where kind = 'payment' and target_id = pay::text)
  then results := results || 'PASS money in: the customer payment already recorded is suggested first'::text; else failures := failures || 'FAIL payment candidate'::text; end if;
  if exists (select 1 from bank_transfer_proposals() where out_txn = 'o3' and in_txn = 'o3i' and kind = 'transfer' and not ambiguous)
     and exists (select 1 from bank_transfer_proposals() where out_txn = 'o10' and in_txn = 'o10i' and kind = 'card_payment')
  then results := results || 'PASS transfer pairs between own accounts are proposed (bank->bank as transfer, bank->card as card payment)'::text; else failures := failures || 'FAIL proposals'::text; end if;
  if (select bool_and(ambiguous) from bank_transfer_proposals() where in_txn = 'o14i') and (select count(*) from bank_transfer_proposals() where in_txn = 'o14i') = 2
  then results := results || 'PASS two equally plausible partners are flagged ambiguous'::text; else failures := failures || 'FAIL ambiguity'::text; end if;
  if not exists (select 1 from bank_transfer_proposals() where out_txn = 'o9' or in_txn = 'o9' or out_txn = 'o2' or in_txn = 'o2' or out_txn = 'pend' or out_txn = 'ox')
  then results := results || 'PASS a card purchase, a deposit with no partner, a pending and an excluded transaction are never proposed as transfers'::text; else failures := failures || 'FAIL proposal scope'::text; end if;

  -- ---- matching comes first ----
  for t in select * from (values
    ('new expense while a matching one exists',          'BC001', 'select resolve_bank_transaction(''o1'', ''expense'', ''{"category":"Fuel"}'')'),
    ('new owner draw while a matching expense exists',   'BC001', 'select resolve_bank_transaction(''o1'', ''owner_draw'', ''{}'')'),
    ('deposit as owner money while a customer payment exists', 'BC001', 'select resolve_bank_transaction(''o2'', ''owner_contribution'', ''{}'')'),
    ('deposit as a refund while a customer payment exists',    'BC001', 'select resolve_bank_transaction(''o2'', ''refund'', ''{"category":"Fuel"}'')'),
    ('deposit as a second customer payment',                   'BC001', 'select resolve_bank_transaction(''o2'', ''customer_payment'', ''{"customer_id":"c1"}'')'),
    ('one side of a detectable transfer as an expense',  'BC001', 'select resolve_bank_transaction(''o3'', ''expense'', ''{"category":"Fuel"}'')'),
    ('other side of a detectable transfer as owner money','BC001', 'select resolve_bank_transaction(''o3i'', ''owner_contribution'', ''{}'')')
  ) as v(label, code, s)
  loop
    select (select count(*) from journal_entries), (select count(*) from bank_matches) into n, n2;
    begin execute t.s; failures := failures || ('FAIL accepted: ' || t.label);
    exception when others then
      if sqlstate = t.code and (select count(*) from journal_entries) = n and (select count(*) from bank_matches) = n2 then results := results || ('PASS refused, nothing created: ' || t.label);
      else failures := failures || ('FAIL ' || t.label || ' -> ' || sqlstate || ' ' || sqlerrm); end if;
    end;
  end loop;

  -- match existing: no new ledger entries, the books do not change
  select count(*), pg_temp.bal(chk) into n, v from journal_entries;
  mid := match_bank_transaction('o1', 'expense', 'e1');
  perform match_bank_transaction('o2', 'payment', pay::text);
  if (select count(*) from journal_entries) = n and pg_temp.bal(chk) = v and pg_temp.mt('o1') = 'expense' and pg_temp.st('o1') = 'recorded' and pg_temp.mt('o2') = 'payment'
     and not (select match_created_event from bank_feed where id = 'o1')
  then results := results || 'PASS matching existing events links them without posting anything new'::text; else failures := failures || 'FAIL match existing'::text; end if;
  if not exists (select 1 from bank_match_candidates('o1')) then results := results || 'PASS a matched event is no longer offered again'::text; else failures := failures || 'FAIL still offered'::text; end if;
  for t in select * from (values
    ('match twice',                              '23505', 'select match_bank_transaction(''o1'', ''expense'', ''e1'')'),
    ('match to an event of a different amount',  '23514', 'select match_bank_transaction(''o9'', ''expense'', ''e2'')'),
    ('match money in to an expense',             '23514', 'select match_bank_transaction(''o12'', ''expense'', ''e2'')'),
    ('match to a transfer side that is not this account','P0002', 'select match_bank_transaction(''o4'', ''transfer'', ''00000000-0000-4000-8000-000000000001'', ''from'')'),
    ('match a pending transaction',              '23514', 'select match_bank_transaction(''pend'', ''expense'', ''e2'')'),
    ('match an excluded transaction',            '23514', 'select match_bank_transaction(''ox'', ''expense'', ''e2'')'),
    ('unknown kind',                             '22023', 'select match_bank_transaction(''o4'', ''bogus'', ''e2'')')
  ) as v(label, code, s)
  loop
    begin execute t.s; failures := failures || ('FAIL accepted: ' || t.label);
    exception when others then
      if sqlstate = t.code then results := results || ('PASS rejected: ' || t.label); else failures := failures || ('FAIL ' || t.label || ' -> ' || sqlstate || ' ' || sqlerrm); end if;
    end;
  end loop;
  -- undo of a match to an existing event only unlinks
  perform undo_bank_resolution('o1');
  if pg_temp.st('o1') = 'needs_review' and exists (select 1 from expenses where id = 'e1') and (select count(*) from journal_entries) = n
  then results := results || 'PASS undoing a match to an existing event only unlinks it; the event stays'::text; else failures := failures || 'FAIL undo match'::text; end if;
  perform match_bank_transaction('o1', 'expense', 'e1');

  -- separate-from-existing: the user may say "this is a different one"
  select pg_temp.bal(chk) into v;
  perform resolve_bank_transaction('o4', 'owner_draw', '{"confirm_new":true}');   -- no candidate exists; confirm is harmless
  if pg_temp.bal(chk) = v - 30000 and abs(pg_temp.bal(draws)) = 30000 and pg_temp.mt('o4') = 'owner_draw' and (select match_created_event from bank_feed where id = 'o4')
  then results := results || 'PASS money out as an owner draw: checking down, Owner Draws up, not an expense'::text; else failures := failures || ('FAIL draw ' || pg_temp.bal(chk)); end if;

  -- ---- new events from money in / out ----
  select pg_temp.bal(chk) into v;
  perform resolve_bank_transaction('o7', 'owner_contribution', '{}');
  if pg_temp.bal(chk) = v + 7000 and pg_temp.bal(contrib) >= 7000 and pg_temp.mt('o7') = 'owner_contribution' then results := results || 'PASS money in as owner money in: checking up, not income'::text; else failures := failures || 'FAIL contribution'::text; end if;
  select pg_temp.bal(chk), pg_temp.bal(inc) into v, v2;
  perform resolve_bank_transaction('o5', 'loan_received', '{"name":"Truck loan","lender":"First Bank"}');
  select loan_id into lid from bank_matches where plaid_transaction_id = 'o5' and undone_at is null;
  if pg_temp.bal(chk) = v + 100000 and pg_temp.bal(inc) = v2 and lid is not null and exists (select 1 from loans where id = lid and principal_cents = 100000 and proceeds_account_id = chk)
  then results := results || 'PASS money in as a loan: checking up, loan owed up, no income'::text; else failures := failures || ('FAIL loan received ' || pg_temp.bal(chk)); end if;
  select pg_temp.bal(chk) into v;
  perform resolve_bank_transaction('o6', 'loan_payment', jsonb_build_object('loan_id', lid, 'interest_cents', 500));
  if pg_temp.bal(chk) = v - 40000 and exists (select 1 from loan_payments where principal_cents = 39500 and interest_cents = 500 and paid_from_account_id = chk) and pg_temp.mt('o6') = 'loan_payment'
  then results := results || 'PASS money out as a loan payment: principal 395.00 + interest 5.00 from the real account'::text; else failures := failures || 'FAIL loan payment'::text; end if;
  select pg_temp.bal(chk), pg_temp.bal(fuel) into v, v2;
  perform resolve_bank_transaction('o8', 'refund', '{"category":"Fuel"}');
  if pg_temp.bal(chk) = v + 2500 and pg_temp.bal(fuel) = v2 - 2500 and pg_temp.mt('o8') = 'refund'
  then results := results || 'PASS money back as a refund: checking up, the expense category goes down, not income'::text; else failures := failures || ('FAIL refund ' || pg_temp.bal(fuel)); end if;
  select pg_temp.bal(card), pg_temp.bal(meals) into v, v2;
  perform resolve_bank_transaction('o9', 'expense', '{"category":"Meals"}');
  if pg_temp.bal(card) = v + 2500 and pg_temp.bal(meals) = v2 + 2500
  then results := results || 'PASS a credit-card transaction becomes an expense on that card (never asked which account)'::text; else failures := failures || 'FAIL card expense'::text; end if;
  select pg_temp.bal(chk), pg_temp.bal(man) into v, v2;
  perform resolve_bank_transaction('o11', 'transfer_to', jsonb_build_object('other_account_id', man));
  perform resolve_bank_transaction('o12', 'transfer_from', jsonb_build_object('other_account_id', man));
  if pg_temp.bal(chk) = v - 9100 + 3300 and pg_temp.bal(man) = v2 + 9100 - 3300 and pg_temp.mt('o11') = 'transfer:from' and pg_temp.mt('o12') = 'transfer:to'
  then results := results || 'PASS transfers to/from an account that has no bank feed of its own'::text; else failures := failures || 'FAIL manual transfers'::text; end if;

  -- ---- direction / eligibility ----
  for t in select * from (values
    ('money in recorded as an expense',   '23514', 'select resolve_bank_transaction(''o13'', ''customer_payment'', ''{"customer_id":"c1","confirm_new":true}'')'),
    ('money in recorded as an owner draw','23514', 'select resolve_bank_transaction(''o14i'', ''owner_draw'', ''{"confirm_new":true}'')'),
    ('money out recorded as a refund',    '23514', 'select resolve_bank_transaction(''o13'', ''refund'', ''{"category":"Fuel","confirm_new":true}'')'),
    ('pending transaction',               '23514', 'select resolve_bank_transaction(''pend'', ''expense'', ''{"category":"Fuel","confirm_new":true}'')'),
    ('excluded transaction',              '23514', 'select resolve_bank_transaction(''ox'', ''expense'', ''{"category":"Fuel","confirm_new":true}'')'),
    ('already recorded transaction',      '23505', 'select resolve_bank_transaction(''o4'', ''owner_draw'', ''{"confirm_new":true}'')'),
    ('category that does not exist',      '23514', 'select resolve_bank_transaction(''o13'', ''expense'', ''{"category":"Nope","confirm_new":true}'')'),
    ('transfer without a second account', '23514', 'select resolve_bank_transaction(''o13'', ''transfer_to'', ''{"confirm_new":true}'')'),
    ('transfer to the same account',      '23514', 'select resolve_bank_transaction(''o13'', ''transfer_to'', jsonb_build_object(''other_account_id'', ''' || chk || ''', ''confirm_new'', true))'),
    ('transfer to a non-bank account',    '23514', 'select resolve_bank_transaction(''o13'', ''transfer_to'', jsonb_build_object(''other_account_id'', ''' || inc || ''', ''confirm_new'', true))'),
    ('loan payment with all interest',    '23514', 'select resolve_bank_transaction(''o13'', ''loan_payment'', jsonb_build_object(''loan_id'', ''' || lid || ''', ''interest_cents'', 6000, ''confirm_new'', true))'),
    ('customer payment without a customer','23514', 'select resolve_bank_transaction(''o14i'', ''customer_payment'', ''{"confirm_new":true}'')'),
    ('unknown way to record',             '22023', 'select resolve_bank_transaction(''o13'', ''bogus'', ''{"confirm_new":true}'')'),
    ('another user''s transaction',       'P0002', 'select resolve_bank_transaction(''tb1'', ''expense'', ''{"category":"Fuel","confirm_new":true}'')')
  ) as v(label, code, s)
  loop
    select (select count(*) from journal_entries), (select count(*) from bank_matches), (select count(*) from transfers) into n, n2, n3;
    begin execute t.s; failures := failures || ('FAIL accepted: ' || t.label);
    exception when others then
      if sqlstate = t.code and (select count(*) from journal_entries) = n and (select count(*) from bank_matches) = n2 then results := results || ('PASS rejected, nothing left behind: ' || t.label);
      else failures := failures || ('FAIL ' || t.label || ' -> ' || sqlstate || ' ' || sqlerrm); end if;
    end;
  end loop;

  -- ---- transfer pairs ----
  select pg_temp.bal(chk), pg_temp.bal(sav), pg_temp.bal(inc), (select count(*) from journal_lines jl join accounts ac on ac.id = jl.account_id where ac.type in ('income','expense')) into v, v2, v3, n;
  tid := confirm_transfer_pair('o3', 'o3i');
  if pg_temp.bal(chk) = v - 20000 and pg_temp.bal(sav) = v2 + 20000 and pg_temp.bal(inc) = v3
     and (select count(*) from journal_lines jl join accounts ac on ac.id = jl.account_id where ac.type in ('income','expense')) = n
     and pg_temp.mt('o3') = 'transfer:from' and pg_temp.mt('o3i') = 'transfer:to' and (select kind = 'transfer' from transfers where id = tid)
  then results := results || 'PASS confirmed pair: one transfer, both bank rows linked, no income or expense touched'::text; else failures := failures || 'FAIL pair'::text; end if;
  select pg_temp.bal(chk), pg_temp.bal(card) into v, v2;
  tid := confirm_transfer_pair('o10', 'o10i');
  if pg_temp.bal(chk) = v - 4500 and pg_temp.bal(card) = v2 - 4500 and (select kind = 'card_payment' from transfers where id = tid)
  then results := results || 'PASS confirmed pair with a credit card is a card payment (card balance owed goes down)'::text; else failures := failures || 'FAIL card pair'::text; end if;
  for t in select * from (values
    ('pair that is not the same amount',   '23514', 'select confirm_transfer_pair(''o13'', ''o14i'')'),
    ('pair given backwards',               '23514', 'select confirm_transfer_pair(''o14i'', ''o13'')'),
    ('pair with itself',                   '23514', 'select confirm_transfer_pair(''o13'', ''o13'')'),
    ('pair with an already recorded side', '23505', 'select confirm_transfer_pair(''o13'', ''o3i'')'),
    ('pair with a pending side',           '23514', 'select confirm_transfer_pair(''pend'', ''o14i'')')
  ) as v(label, code, s)
  loop
    begin execute t.s; failures := failures || ('FAIL accepted: ' || t.label);
    exception when others then
      if sqlstate = t.code then results := results || ('PASS rejected: ' || t.label); else failures := failures || ('FAIL ' || t.label || ' -> ' || sqlstate || ' ' || sqlerrm); end if;
    end;
  end loop;
  -- the ambiguous one: the user chooses which partner
  tid := confirm_transfer_pair('o13', 'o14i');
  if pg_temp.st('o13') = 'recorded' and pg_temp.st('o14') = 'needs_review' and not exists (select 1 from bank_transfer_proposals() where in_txn = 'o14i')
  then results := results || 'PASS the user picks the partner when two are plausible; the other stays open'::text; else failures := failures || 'FAIL ambiguous pick'::text; end if;

  -- ---- undo of events this bank transaction created ----
  select pg_temp.bal(chk) into v;
  perform undo_bank_resolution('o4');
  if pg_temp.bal(chk) = v + 30000 and pg_temp.st('o4') = 'needs_review' and (select voided_at is not null from owner_transactions where kind = 'draw' limit 1)
  then results := results || 'PASS undo of an owner draw made here: books reversed, event voided, transaction back in review'::text; else failures := failures || 'FAIL undo draw'::text; end if;
  select pg_temp.bal(chk), pg_temp.bal(sav) into v, v2;
  perform undo_bank_resolution('o3i');
  if pg_temp.bal(chk) = v + 20000 and pg_temp.bal(sav) = v2 - 20000 and pg_temp.st('o3') = 'needs_review' and pg_temp.st('o3i') = 'needs_review' and (select voided_at is not null from transfers where id = (select transfer_id from bank_matches where plaid_transaction_id = 'o3' limit 1))
  then results := results || 'PASS undoing one side of a transfer pair voids the transfer and reopens both bank transactions'::text; else failures := failures || 'FAIL undo pair'::text; end if;
  select pg_temp.bal(card) into v;
  perform undo_bank_resolution('o9');
  if pg_temp.bal(card) = v - 2500 and not exists (select 1 from expenses where vendor = 'DINER') and pg_temp.st('o9') = 'needs_review'
  then results := results || 'PASS undo of an expense made here: reversed and removed, transaction back in review'::text; else failures := failures || 'FAIL undo expense'::text; end if;
  perform undo_bank_resolution('o8'); perform undo_bank_resolution('o6');
  perform undo_bank_resolution('o5');
  if exists (select 1 from loans where id = lid and voided_at is not null) and pg_temp.st('o5') = 'needs_review'
  then results := results || 'PASS undo of a loan payment and then the loan itself'::text; else failures := failures || 'FAIL undo loan'::text; end if;
  begin perform undo_bank_resolution('o4'); failures := failures || 'FAIL undo of an unrecorded transaction';
  exception when others then if sqlstate = 'P0002' then results := results || 'PASS undoing something not recorded is rejected'::text; else failures := failures || ('FAIL undo none ' || sqlstate); end if; end;

  -- ---- editing or voiding what is linked ----
  perform resolve_bank_transaction('o4', 'owner_draw', '{}');
  select owner_transaction_id into oid from bank_matches where plaid_transaction_id = 'o4' and undone_at is null;
  begin
    perform update_owner_transaction(oid, '2026-06-15', 31000, chk, null);
    set constraints all immediate;
    failures := failures || 'FAIL changed the amount of a linked owner draw';
  exception when others then
    if sqlstate = '23514' then results := results || 'PASS changing the amount of a linked event is refused until the link is removed'::text; else failures := failures || ('FAIL amount edit ' || sqlstate || ' ' || sqlerrm); end if;
  end;
  set constraints all deferred;
  begin
    perform update_owner_transaction(oid, '2026-06-16', 30000, chk, 'new note');
    set constraints all immediate;
    if pg_temp.st('o4') = 'recorded' then results := results || 'PASS changing only the date or note of a linked event is fine'::text; else failures := failures || 'FAIL date edit unlinked'::text; end if;
  exception when others then failures := failures || ('FAIL date edit ' || sqlerrm); end;
  set constraints all deferred;
  begin
    perform update_owner_transaction(oid, '2026-06-16', 30000, sav, null);
    set constraints all immediate;
    failures := failures || 'FAIL moved a linked event to another account';
  exception when others then if sqlstate = '23514' then results := results || 'PASS moving a linked event to a different account is refused'::text; else failures := failures || ('FAIL acct edit ' || sqlstate); end if; end;
  set constraints all deferred;
  begin
    perform void_owner_transaction(oid);
    set constraints all immediate;
    if pg_temp.st('o4') = 'needs_review' and (select undone_reason from bank_matches where owner_transaction_id = oid) = 'The recorded item was voided.'
    then results := results || 'PASS voiding a linked event releases the link; the bank transaction returns to review'::text; else failures := failures || ('FAIL void releases ' || pg_temp.st('o4')); end if;
  exception when others then failures := failures || ('FAIL void ' || sqlerrm); end;
  set constraints all deferred;
  -- expenses: o1 is linked to e1 (entered by hand: 80.00 from checking)
  perform match_bank_transaction('o1', 'expense', 'e1');
  begin
    perform save_expense(jsonb_build_object('id','e1','date','2026-06-11','vendor','Loves','category','Fuel','amount',8500,'notes',null), chk);
    set constraints all immediate;
    failures := failures || 'FAIL changed the amount of a linked expense';
  exception when others then if sqlstate = '23514' then results := results || 'PASS changing the amount of a linked expense is refused'::text; else failures := failures || ('FAIL expense amount ' || sqlstate || ' ' || sqlerrm); end if; end;
  set constraints all deferred;
  begin
    perform save_expense(jsonb_build_object('id','e1','date','2026-06-11','vendor','Loves','category','Fuel','amount',8000,'notes',null), sav);
    set constraints all immediate;
    failures := failures || 'FAIL moved a linked expense to another account';
  exception when others then if sqlstate = '23514' then results := results || 'PASS changing "paid from" on a linked expense is refused'::text; else failures := failures || ('FAIL expense account ' || sqlstate || ' ' || sqlerrm); end if; end;
  set constraints all deferred;
  begin
    perform save_expense(jsonb_build_object('id','e1','date','2026-06-11','vendor','Loves','category','Meals','amount',8000,'notes',null), chk);
    set constraints all immediate;
    if pg_temp.st('o1') = 'recorded' then results := results || 'PASS changing only the category of a linked expense keeps the link'::text; else failures := failures || 'FAIL category edit unlinked'::text; end if;
  exception when others then failures := failures || ('FAIL category edit ' || sqlerrm); end;
  set constraints all deferred;
  perform delete_expense('e1');
  if pg_temp.st('o1') = 'needs_review' and not exists (select 1 from bank_matches where expense_id = 'e1')
  then results := results || 'PASS deleting a linked expense releases the bank transaction'::text; else failures := failures || 'FAIL delete linked expense'::text; end if;

  -- payments and refunds
  begin
    perform void_payment(pay);
    set constraints all immediate;
    if pg_temp.st('o2') = 'needs_review' then results := results || 'PASS voiding a customer payment releases the deposit back to review'::text; else failures := failures || 'FAIL void payment'::text; end if;
  exception when others then failures := failures || ('FAIL void payment ' || sqlerrm); end;
  set constraints all deferred;
  perform resolve_bank_transaction('o8', 'refund', '{"category":"Fuel"}');
  select refund_id into oid from bank_matches where plaid_transaction_id = 'o8' and undone_at is null;
  begin
    perform update_refund(oid, '2026-06-19', 2600, chk, 'Fuel', null);
    set constraints all immediate;
    failures := failures || 'FAIL changed a linked refund amount';
  exception when others then if sqlstate = '23514' then results := results || 'PASS changing a linked refund''s amount is refused'::text; else failures := failures || ('FAIL refund edit ' || sqlstate); end if; end;
  set constraints all deferred;
  begin
    perform void_refund(oid);
    set constraints all immediate;
    if pg_temp.st('o8') = 'needs_review' then results := results || 'PASS voiding a refund releases the bank transaction'::text; else failures := failures || 'FAIL void refund'::text; end if;
  exception when others then failures := failures || ('FAIL void refund ' || sqlerrm); end;
  set constraints all deferred;

  -- ---- exclude / unsure / restore ----
  begin perform exclude_bank_transaction('o13'); failures := failures || 'FAIL excluded a recorded transaction';
  exception when others then if sqlstate = '23514' then results := results || 'PASS a recorded transaction cannot be excluded until undone'::text; else failures := failures || ('FAIL exclude recorded ' || sqlstate); end if; end;
  perform exclude_bank_transaction('o14');
  if pg_temp.st('o14') = 'excluded' then results := results || 'PASS exclude a bank transaction (it stays visible as excluded)'::text; else failures := failures || 'FAIL exclude'::text; end if;
  begin perform resolve_bank_transaction('o14', 'unsure', '{}'); failures := failures || 'FAIL unsure on excluded';
  exception when others then if sqlstate = '23514' then results := results || 'PASS an excluded transaction cannot be marked unsure'::text; else failures := failures || ('FAIL unsure excluded ' || sqlstate); end if; end;
  perform restore_bank_transaction('o14');
  perform resolve_bank_transaction('o14', 'unsure', '{"notes":"ask my accountant"}');
  if pg_temp.st('o14') = 'unsure' and (select review_note from bank_feed where id = 'o14') = 'ask my accountant'
  then results := results || 'PASS "Not sure" keeps the transaction open with a note (no accounting guess)'::text; else failures := failures || 'FAIL unsure'::text; end if;
  perform restore_bank_transaction('o14');
  if pg_temp.st('o14') = 'needs_review' and (select review_note from bank_feed where id = 'o14') is null then results := results || 'PASS "put back in review" clears Not sure'::text; else failures := failures || 'FAIL restore'::text; end if;

  -- ---- pending -> posted with a link, and a bank removal (privileged setup) ----
  perform save_expense(jsonb_build_object('id','e3','date','2026-06-26','vendor','P1','category','Fuel','amount',700,'notes',null), chk);
  perform save_expense(jsonb_build_object('id','e4','date','2026-06-26','vendor','P2','category','Fuel','amount',800,'notes',null), chk);
  reset role;
  insert into plaid_transactions (id,user_id,plaid_item_id,plaid_account_id,date,name,amount,pending) values ('pp1',a,'item-a','pa1','2026-06-26','PEND1',700,true),('pp2',a,'item-a','pa1','2026-06-26','PEND2',800,true);
  insert into bank_matches (user_id, plaid_transaction_id, kind, expense_id) values (a,'pp1','expense','e3'),(a,'pp2','expense','e4');
  perform apply_plaid_sync_page(a, 'item-a',
    '[{"id":"sp1","plaid_account_id":"pa1","date":"2026-06-27","name":"PEND1","amount":700,"pending":false,"pending_transaction_id":"pp1"},
      {"id":"sp2","plaid_account_id":"pa1","date":"2026-06-27","name":"PEND2","amount":850,"pending":false,"pending_transaction_id":"pp2"}]', '[]', '["pp1","pp2"]');
  if (select expense_id from bank_matches where plaid_transaction_id = 'sp1' and undone_at is null) = 'e3' and not exists (select 1 from bank_matches where plaid_transaction_id = 'pp1' and undone_at is null)
  then results := results || 'PASS pending->posted: a valid link moves to the posted transaction (one transaction, one link)'::text; else failures := failures || 'FAIL link move'::text; end if;
  if not exists (select 1 from bank_matches where plaid_transaction_id in ('sp2','pp2') and undone_at is null) and exists (select 1 from expenses where id = 'e4')
     and (select undone_reason like 'The final amount or account differs%' from bank_matches where expense_id = 'e4') and (select review_note is not null from plaid_transactions where id = 'sp2')
  then results := results || 'PASS pending->posted with a different final amount: link released with a note, the expense is left for the user to fix'::text; else failures := failures || 'FAIL link release'::text; end if;
  perform apply_plaid_sync_page(a, 'item-a', '[]', '[]', '["sp1"]');
  if (select status from plaid_transactions where id = 'sp1') = 'removed' and not exists (select 1 from bank_matches where plaid_transaction_id = 'sp1' and undone_at is null)
     and exists (select 1 from expenses where id = 'e3') and (select count(*) from journal_entries where source_id = 'e3' and reverses_entry_id is null) = 1
  then results := results || 'PASS the bank removing a recorded transaction releases the link; what you recorded stays in the books'::text; else failures := failures || 'FAIL removal'::text; end if;

  -- ---- isolation ----
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  if (select count(*) from bank_feed where user_id = a) = 0 and (select count(*) from bank_matches) = 0 and (select count(*) from refunds) = 0 and (select count(*) from bank_feed) = 1
  then results := results || 'PASS B sees only their own bank feed, links and refunds'::text; else failures := failures || 'FAIL B reads'::text; end if;
  for t in select * from (values
    ('B suggestions for A''s transaction', 'P0002', 'select * from bank_match_candidates(''o13'')'),
    ('B resolves A''s transaction',        'P0002', 'select resolve_bank_transaction(''o13'', ''owner_draw'', ''{"confirm_new":true}'')'),
    ('B undoes A''s link',                 'P0002', 'select undo_bank_resolution(''o13'')'),
    ('B excludes A''s transaction',        'P0002', 'select exclude_bank_transaction(''o13'')'),
    ('B pairs A''s transactions',          'P0002', 'select confirm_transfer_pair(''o13'', ''o14i'')'),
    ('B links own transaction to A''s expense', 'P0002', 'select match_bank_transaction(''tb1'', ''expense'', ''e4'')'),
    ('B writes bank_matches directly',     '42501', 'insert into bank_matches (user_id, plaid_transaction_id, kind, expense_id) values (auth.uid(), ''tb1'', ''expense'', ''e4'')'),
    ('B updates bank_matches directly',    '42501', 'update bank_matches set undone_at = now()'),
    ('B deletes bank_matches directly',    '42501', 'delete from bank_matches'),
    ('B writes refunds directly',          '42501', 'insert into refunds (user_id, refund_date, amount_cents, account_id, expense_account_id) values (auth.uid(), ''2026-06-01'', 1, auth.uid(), auth.uid())'),
    ('B truncates bank_matches',           '42501', 'truncate bank_matches'),
    ('B calls an internal function',       '42501', 'select _link_bank(auth.uid(), ''tb1'', ''expense'', ''e4'', null, false)'),
    ('B calls the match check directly',   '42501', 'select _bank_candidates(auth.uid(), null)'),
    ('B edits A''s refund',                'P0002', 'select void_refund(''00000000-0000-4000-8000-000000000001'')')
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
  begin perform 1 from bank_matches; failures := failures || 'FAIL anon read links';
  exception when insufficient_privilege then results := results || 'PASS anon cannot read links'::text; end;
  begin perform 1 from bank_feed; failures := failures || 'FAIL anon read feed';
  exception when insufficient_privilege then results := results || 'PASS anon cannot read the feed view'::text; end;
  begin perform resolve_bank_transaction('o13', 'owner_draw', '{}'); failures := failures || 'FAIL anon resolve';
  exception when insufficient_privilege then results := results || 'PASS anon cannot resolve'::text; end;
  reset role;
  if has_function_privilege('authenticated', 'public.resolve_bank_transaction(text,text,jsonb)', 'execute')
     and has_function_privilege('authenticated', 'public.confirm_transfer_pair(text,text,text)', 'execute')
     and has_function_privilege('authenticated', 'public.undo_bank_resolution(text)', 'execute')
     and not has_function_privilege('anon', 'public.undo_bank_resolution(text)', 'execute')
     and not has_function_privilege('authenticated', 'public._match_problem(public.bank_matches)', 'execute')
     and not has_function_privilege('authenticated', 'public._link_bank(uuid,text,text,text,text,boolean)', 'execute')
     and not has_function_privilege('authenticated', 'public._supersede_pending(uuid,text,text)', 'execute')
     and not has_function_privilege('authenticated', 'public._remove_plaid_txn(uuid,text)', 'execute')
  then results := results || 'PASS only the public review functions are callable by signed-in users'::text; else failures := failures || 'FAIL privileges'::text; end if;
  if to_regprocedure('public.categorize_plaid_transaction(text,text)') is null
     and not exists (select 1 from information_schema.columns where table_name = 'plaid_transactions' and column_name in ('expense_id', 'category'))
  then results := results || 'PASS the old direct link columns and categorize function are gone'::text; else failures := failures || 'FAIL old columns'::text; end if;

  -- ---- every deferred check holds on the final state ----
  begin
    set constraints all immediate;
    results := results || 'PASS all deferred ledger and link checks hold on the final state'::text;
  exception when others then failures := failures || ('FAIL final deferred checks: ' || sqlerrm); end;

  if array_length(failures,1) is null then
    raise exception 'ROLLED BACK - ALL PASS (% checks)', array_length(results,1);
  else
    raise exception 'ROLLED BACK - % FAILURES: %', array_length(failures,1), array_to_string(failures,' | ');
  end if;
end
$test$;
