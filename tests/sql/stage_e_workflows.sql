-- Stage E1 tests: the atomic, ledger-backed workflows the app now calls: expenses (Paid from), bank transactions, invoices (save + post),
-- starting balances, ledger-backed reports, category-name protection, retired shadow table, privileges, ownership.
-- One DO block, always rolls back. Success = message starts 'ROLLED BACK - ALL PASS'.
do $test$
declare
  a uuid := '00000000-0000-4000-8000-0000000000aa';
  b uuid := '00000000-0000-4000-8000-0000000000bb';
  c uuid := '00000000-0000-4000-8000-0000000000cc';
  chk uuid; sav uuid; card uuid; b_chk uuid; c_chk uuid; ar uuid; inc uuid; eqp uuid; fuel uuid; meals uuid; uncat uuid; contribs uuid;
  n int; n2 int; v bigint; v2 bigint; t record; ent uuid; r record; pay uuid;
  results text[] := '{}'; failures text[] := '{}';
begin
  insert into auth.users (id,email,aud,role) values
    (a,'ta@example.invalid','authenticated','authenticated'),(b,'tb@example.invalid','authenticated','authenticated'),(c,'tc@example.invalid','authenticated','authenticated');
  insert into plaid_items (id,user_id,item_id,access_token) values ('pi-a',a,'item-a','x'),('pi-b',b,'item-b','x');
  insert into bank_accounts (id,user_id,name,last4,balance,last_updated,subtype,plaid_item_id,plaid_account_id) values
    ('bk1',a,'Checking','1111',0,'x',null,'item-a','pa1'),('bk2',a,'Savings','2222',0,'x',null,null,null),
    ('bk3',a,'Visa','3333',0,'x','credit card','item-a','pa3'),('bkb',b,'B Checking','9999',0,'x',null,'item-b','pab'),('bkc',c,'C Checking','8888',0,'x',null,null,null);
  insert into expense_categories (user_id,name) values (a,'Fuel'),(a,'Meals'),(b,'Fuel'),(c,'Fuel');
  insert into customers (id,user_id,name) values ('c1',a,'ACME'),('cb',b,'B Co');
  insert into plaid_transactions (id,user_id,plaid_item_id,plaid_account_id,date,name,merchant_name,amount,pending,excluded) values
    ('t1',a,'item-a','pa1','2026-06-11','LOVES #1','Loves',8000,false,false),
    ('t2',a,'item-a','pa1','2026-06-11','DEPOSIT',null,-5000,false,false),
    ('t3',a,'item-a','pa3','2026-06-12','DINER',null,2500,false,false),
    ('t4',a,'item-a','pa1','2026-06-12','SKIP ME',null,700,false,true),
    ('t5',a,'item-a','pa-unknown','2026-06-12','MYSTERY',null,900,false,false),
    ('t6',a,'item-a','pa1','2026-06-13','OTHER',null,600,false,false),
    ('tb1',b,'item-b','pab','2026-06-11','B SHOP',null,1000,false,false);
  insert into expenses (id,user_id,date,vendor,category,amount,notes) values ('eb1',b,'2026-06-10','B Vendor','Fuel',1000,null);
  perform seed_chart_of_accounts(a); perform seed_chart_of_accounts(b); perform seed_chart_of_accounts(c);
  select id into chk from accounts where bank_account_id='bk1'; select id into sav from accounts where bank_account_id='bk2';
  select id into card from accounts where bank_account_id='bk3'; select id into b_chk from accounts where bank_account_id='bkb';
  select id into c_chk from accounts where bank_account_id='bkc';
  select id into ar from accounts where user_id=a and system_key='accounts_receivable';
  select id into inc from accounts where user_id=a and system_key='income';
  select id into eqp from accounts where user_id=a and system_key='equipment';
  select id into uncat from accounts where user_id=a and system_key='uncategorized_expense';
  select id into contribs from accounts where user_id=a and system_key='owner_contributions';
  select id into fuel from accounts where user_id=a and name='Fuel'; select id into meals from accounts where user_id=a and name='Meals';
  execute 'create function pg_temp.bal(p uuid) returns bigint language sql as $f$ select balance_cents from account_balances where account_id = p $f$';
  execute 'create function pg_temp.ents(s text) returns int language sql as $f$ select count(*)::int from journal_entry_trace where source_id = s $f$';
  execute 'create function pg_temp.act(s text) returns int language sql as $f$ select count(*)::int from journal_entry_trace where source_id = s and status = ''active'' $f$';
  execute 'create function pg_temp.gaps(u uuid) returns int language sql as $f$ select count(*)::int from ledger_gaps where user_id = u $f$';

  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;

  -- ---- chart setup is idempotent ----
  select count(*) into n from accounts where user_id = a;
  perform ensure_books(); perform ensure_books();
  select count(*) into n2 from accounts where user_id = a;
  if n = n2 and n > 0 then results := results || 'PASS ensure_books is idempotent'::text; else failures := failures || ('FAIL ensure_books ' || n || '/' || n2); end if;

  -- ---- starting balances ----
  perform set_opening_balance(chk, 100000, '2026-06-01');
  perform set_opening_balance(card, 20000, '2026-06-01');
  if pg_temp.bal(chk) = 100000 and pg_temp.bal(card) = 20000
     and (select amount_cents from opening_balances where account_id = chk) = 100000
     and (select amount_cents from opening_balances where account_id = card) = 20000
  then results := results || 'PASS starting balances: bank balance and card amount owed post and read back as typed'::text;
  else failures := failures || ('FAIL opening balances ' || pg_temp.bal(chk) || '/' || pg_temp.bal(card)); end if;
  perform set_opening_balance(chk, 150000, '2026-06-01');
  if pg_temp.bal(chk) = 150000 and pg_temp.ents(chk::text) = 3 and pg_temp.act(chk::text) = 1
  then results := results || 'PASS changing a starting balance = reversal + repost'::text; else failures := failures || ('FAIL opening change ' || pg_temp.bal(chk)); end if;
  perform set_opening_balance(chk, 0, '2026-06-01');
  if pg_temp.bal(chk) = 0 and not exists (select 1 from opening_balances where account_id = chk)
  then results := results || 'PASS clearing a starting balance reverses it'::text; else failures := failures || 'FAIL opening clear'; end if;
  perform set_opening_balance(chk, 100000, '2026-06-01');
  for t in select * from (values
    ('starting balance on A/R',            '23514', format('select set_opening_balance(%L, 100, ''2026-06-01'')', ar)),
    ('starting balance on an expense acct','23514', format('select set_opening_balance(%L, 100, ''2026-06-01'')', fuel)),
    ('starting balance on another user''s account','P0002', format('select set_opening_balance(%L, 100, ''2026-06-01'')', b_chk)),
    ('starting balance without a date',    '23514', format('select set_opening_balance(%L, 100, null)', sav))
  ) as v(label, code, s)
  loop
    begin execute t.s; failures := failures || ('FAIL accepted: ' || t.label);
    exception when others then
      if sqlstate = t.code then results := results || ('PASS rejected: ' || t.label); else failures := failures || ('FAIL ' || t.label || ' -> ' || sqlstate || ' ' || sqlerrm); end if;
    end;
  end loop;
  select accounts_without_starting_balance, has_bank_accounts into r from dashboard_summary('2026-06-30', '2026-06-01', '2026-06-30');
  if r.accounts_without_starting_balance = 1 and r.has_bank_accounts
  then results := results || 'PASS dashboard flags the account that has no starting balance yet'::text; else failures := failures || ('FAIL missing start ' || r.accounts_without_starting_balance); end if;

  -- ---- expenses: Paid from is part of the save, atomically ----
  perform save_expense('{"id":"e1","date":"2026-06-10","vendor":"Loves","category":"Fuel","amount":12000,"notes":"Diesel"}', chk);
  if pg_temp.bal(fuel) = 12000 and pg_temp.bal(chk) = 88000 and pg_temp.act('e1') = 1 and pg_temp.gaps(a) = 0
     and (select source_type from journal_entries where source_id = 'e1' and reverses_entry_id is null) = 'expense'
  then results := results || 'PASS save_expense: expense row + Dr Fuel / Cr the chosen bank account in one step; traceable'::text;
  else failures := failures || ('FAIL save_expense ' || pg_temp.bal(fuel) || '/' || pg_temp.bal(chk)); end if;
  begin set constraints all immediate; results := results || 'PASS commit-time ledger checks run correctly as the signed-in role'::text;
  exception when others then failures := failures || ('FAIL commit-time checks as authenticated: ' || sqlstate || ' ' || sqlerrm); end;
  set constraints all deferred;
  perform save_expense('{"id":"e1","date":"2026-06-10","vendor":"Loves","category":"Fuel","amount":12000,"notes":"Diesel"}', chk);
  if pg_temp.ents('e1') = 1 then results := results || 'PASS saving an expense unchanged posts nothing new'::text; else failures := failures || ('FAIL resave churn ' || pg_temp.ents('e1')); end if;
  perform save_expense('{"id":"e1","date":"2026-06-10","vendor":"Loves","category":"Fuel","amount":15000,"notes":"Diesel"}');
  if pg_temp.bal(fuel) = 15000 and pg_temp.bal(chk) = 85000 and pg_temp.ents('e1') = 3 and pg_temp.act('e1') = 1
  then results := results || 'PASS editing the amount keeps the same Paid from account (reversal + repost)'::text; else failures := failures || ('FAIL edit amount ' || pg_temp.bal(fuel) || '/' || pg_temp.bal(chk)); end if;
  perform save_expense('{"id":"e1","date":"2026-06-10","vendor":"Loves","category":"Fuel","amount":15000,"notes":"Diesel"}', card);
  if pg_temp.bal(chk) = 100000 and pg_temp.bal(card) = 35000 and pg_temp.act('e1') = 1
  then results := results || 'PASS changing Paid from moves the money: bank restored, credit card owes more'::text; else failures := failures || ('FAIL change paid from ' || pg_temp.bal(chk) || '/' || pg_temp.bal(card)); end if;
  perform save_expense('{"id":"e1","date":"2026-06-10","vendor":"Loves","category":"Meals","amount":15000,"notes":"Diesel"}', chk);
  if pg_temp.bal(fuel) = 0 and pg_temp.bal(meals) = 15000 and pg_temp.bal(card) = 20000 and pg_temp.bal(chk) = 85000
  then results := results || 'PASS changing the category moves the expense between accounts'::text; else failures := failures || ('FAIL change category ' || pg_temp.bal(fuel) || '/' || pg_temp.bal(meals)); end if;
  perform save_expense('{"id":"e1","date":"2026-06-10","vendor":"Loves","category":"Fuel","amount":15000,"notes":"Diesel"}', chk);

  perform save_expense('{"id":"e2","date":"2026-06-11","vendor":"Shop","category":"Meals","amount":3000}', contribs);
  if pg_temp.bal(contribs) = 3000 and pg_temp.bal(meals) = 3000 and pg_temp.bal(chk) = 85000
     and exists (select 1 from journal_entries where source_id = 'e2' and memo like '%paid personally by owner%')
  then results := results || 'PASS "I paid personally": Dr expense / Cr Owner Contributions, no bank account pretended'::text; else failures := failures || ('FAIL owner paid ' || pg_temp.bal(contribs)); end if;

  perform save_expense('{"id":"e3","date":"2026-06-12","vendor":"Unsorted","category":"","amount":1000}', chk);
  if pg_temp.bal(uncat) = 1000 then results := results || 'PASS a blank category is the explicit Uncategorized Expense'::text; else failures := failures || 'FAIL blank category'; end if;

  -- ---- rejected expenses leave nothing behind ----
  for t in select * from (values
    ('new expense without Paid from',     '23514', '{"id":"x1","date":"2026-06-10","vendor":"V","category":"Fuel","amount":100}', null::uuid),
    ('Paid from A/R',                     '23514', '{"id":"x1","date":"2026-06-10","vendor":"V","category":"Fuel","amount":100}', ar),
    ('Paid from Equipment',               '23514', '{"id":"x1","date":"2026-06-10","vendor":"V","category":"Fuel","amount":100}', eqp),
    ('Paid from an expense account',      '23514', '{"id":"x1","date":"2026-06-10","vendor":"V","category":"Fuel","amount":100}', fuel),
    ('Paid from another user''s account', '23514', '{"id":"x1","date":"2026-06-10","vendor":"V","category":"Fuel","amount":100}', b_chk),
    ('category that does not exist',      '23514', '{"id":"x1","date":"2026-06-10","vendor":"V","category":"Nope","amount":100}', chk),
    ('category named like a built-in account','23514', '{"id":"x1","date":"2026-06-10","vendor":"V","category":"Income","amount":100}', chk),
    ('zero amount',                       '23514', '{"id":"x1","date":"2026-06-10","vendor":"V","category":"Fuel","amount":0}', chk),
    ('no amount',                         '23514', '{"id":"x1","date":"2026-06-10","vendor":"V","category":"Fuel"}', chk),
    ('no date',                           '23514', '{"id":"x1","vendor":"V","category":"Fuel","amount":100}', chk),
    ('no id',                             '23514', '{"date":"2026-06-10","vendor":"V","category":"Fuel","amount":100}', chk),
    ('another user''s expense id',        'P0002', '{"id":"eb1","date":"2026-06-10","vendor":"V","category":"Fuel","amount":100}', chk)
  ) as v(label, code, js, pf)
  loop
    select (select count(*) from expenses) + (select count(*) from journal_entries), pg_temp.bal(chk) into n, v;
    begin perform save_expense(t.js::jsonb, t.pf); failures := failures || ('FAIL accepted: ' || t.label);
    exception when others then
      if sqlstate = t.code and (select count(*) from expenses) + (select count(*) from journal_entries) = n and pg_temp.bal(chk) = v
      then results := results || ('PASS rejected, nothing left behind: ' || t.label);
      else failures := failures || ('FAIL ' || t.label || ' -> ' || sqlstate || ' ' || sqlerrm); end if;
    end;
  end loop;
  reset role;
  select amount into n from expenses where id = 'eb1';
  if n = 1000 then results := results || 'PASS another user''s expense was not touched'::text; else failures := failures || 'FAIL B expense changed'; end if;
  set local role authenticated;

  -- ---- category names can no longer collide with built-in accounts ----
  for t in select * from (values
    ('category "Income"',             'insert into expense_categories (user_id,name) values (auth.uid(), ''Income'')'),
    ('category "income" (any case)',  'insert into expense_categories (user_id,name) values (auth.uid(), '' income '')'),
    ('category "Interest Expense"',   'insert into expense_categories (user_id,name) values (auth.uid(), ''Interest Expense'')'),
    ('category "Uncategorized Expense"','insert into expense_categories (user_id,name) values (auth.uid(), ''Uncategorized Expense'')'),
    ('category "Equipment"',          'insert into expense_categories (user_id,name) values (auth.uid(), ''Equipment'')'),
    ('category "Loan - Truck"',       'insert into expense_categories (user_id,name) values (auth.uid(), ''Loan - Truck'')'),
    ('category named like a bank account','insert into expense_categories (user_id,name) values (auth.uid(), ''Checking (1111)'')'),
    ('renaming a category to a built-in name','update expense_categories set name = ''Owner Draws'' where name = ''Meals''')
  ) as v(label, s)
  loop
    begin execute t.s; failures := failures || ('FAIL accepted: ' || t.label);
    exception when others then
      if sqlstate = '23514' then results := results || ('PASS rejected: ' || t.label); else failures := failures || ('FAIL ' || t.label || ' -> ' || sqlstate || ' ' || sqlerrm); end if;
    end;
  end loop;
  insert into expense_categories (user_id,name) values (auth.uid(), 'Tires');
  perform save_expense('{"id":"e4","date":"2026-06-13","vendor":"Tire Shop","category":"Tires","amount":2000}', chk);
  if (select name from accounts where id = (select account_id from journal_lines where entry_id = (select id from journal_entry_trace where source_id = 'e4' and status = 'active') and debit_cents > 0)) = 'Tires'
  then results := results || 'PASS a brand-new category gets its own expense account and posts there'::text; else failures := failures || 'FAIL new category'; end if;

  -- ---- app roles cannot write the financial tables directly any more ----
  for t in select * from (values
    ('INSERT expenses',            '42501', 'insert into expenses (id,user_id,date,vendor,amount) values (''zz'', auth.uid(), ''2026-06-10'', ''v'', 100)'),
    ('UPDATE expenses',            '42501', 'update expenses set amount = 1'),
    ('DELETE expenses',            '42501', 'delete from expenses'),
    ('INSERT invoices',            '42501', 'insert into invoices (id,user_id,invoice_number,customer,amount,status) values (''zz'', auth.uid(), ''9'', ''c'', 100, ''Draft'')'),
    ('UPDATE invoices',            '42501', 'update invoices set amount = 1'),
    ('DELETE invoices',            '42501', 'delete from invoices'),
    ('UPDATE invoice_line_items',  '42501', 'update invoice_line_items set amount = 1'),
    ('TRUNCATE expenses',          '42501', 'truncate expenses'),
    ('TRUNCATE customers',         '42501', 'truncate customers')
  ) as v(label, code, s)
  loop
    begin execute t.s; failures := failures || ('FAIL accepted: ' || t.label);
    exception when others then
      if sqlstate = t.code then results := results || ('PASS rejected: ' || t.label); else failures := failures || ('FAIL ' || t.label || ' -> ' || sqlstate || ' ' || sqlerrm); end if;
    end;
  end loop;
  if to_regclass('public.invoice_payments') is null then results := results || 'PASS the invoice_payments shadow table is retired'::text; else failures := failures || 'FAIL invoice_payments still exists'; end if;

  -- ---- bank transactions become expenses paid from THEIR OWN connected account ----
  select pg_temp.bal(chk), pg_temp.bal(fuel) into v, v2;
  perform categorize_plaid_transaction('t1', 'Fuel');
  if pg_temp.bal(chk) = v - 8000 and pg_temp.bal(fuel) = v2 + 8000
     and (select expense_id is not null and category = 'Fuel' from plaid_transactions where id = 't1')
     and pg_temp.act((select expense_id from plaid_transactions where id = 't1')) = 1
  then results := results || 'PASS Plaid checking transaction: expense paid from that checking account, linked both ways'::text;
  else failures := failures || ('FAIL categorize t1 ' || pg_temp.bal(chk)); end if;
  select pg_temp.bal(card) into v;
  perform categorize_plaid_transaction('t3', 'Meals');
  if pg_temp.bal(card) = v + 2500 then results := results || 'PASS Plaid credit-card transaction: expense charged to that credit card'::text; else failures := failures || ('FAIL categorize t3 ' || pg_temp.bal(card)); end if;
  for t in select * from (values
    ('already categorized',                  '23505', 'select categorize_plaid_transaction(''t1'', ''Fuel'')'),
    ('money-in transaction',                 '23514', 'select categorize_plaid_transaction(''t2'', ''Fuel'')'),
    ('excluded transaction',                 '23514', 'select categorize_plaid_transaction(''t4'', ''Fuel'')'),
    ('transaction from an account not in the books','23514', 'select categorize_plaid_transaction(''t5'', ''Fuel'')'),
    ('category that does not exist',         '23514', 'select categorize_plaid_transaction(''t6'', ''Nope'')'),
    ('unknown transaction',                  'P0002', 'select categorize_plaid_transaction(''nope'', ''Fuel'')'),
    ('another user''s transaction',          'P0002', 'select categorize_plaid_transaction(''tb1'', ''Fuel'')')
  ) as v(label, code, s)
  loop
    select (select count(*) from expenses), (select count(*) from journal_entries) into n, n2;
    begin execute t.s; failures := failures || ('FAIL accepted: ' || t.label);
    exception when others then
      if sqlstate = t.code and (select count(*) from expenses) = n and (select count(*) from journal_entries) = n2
         and not exists (select 1 from plaid_transactions where id in ('t2','t4','t5','t6','tb1') and (expense_id is not null or category is not null))
      then results := results || ('PASS rejected, nothing left behind: ' || t.label);
      else failures := failures || ('FAIL ' || t.label || ' -> ' || sqlstate || ' ' || sqlerrm); end if;
    end;
  end loop;
  -- deleting the expense returns the bank transaction to the review queue and reverses the books
  declare eid text; begin
    select expense_id into eid from plaid_transactions where id = 't1';
    select pg_temp.bal(chk) into v;
    perform delete_expense(eid);
    if not exists (select 1 from expenses where id = eid) and pg_temp.bal(chk) = v + 8000 and pg_temp.act(eid) = 0
       and (select expense_id is null and category is null from plaid_transactions where id = 't1')
    then results := results || 'PASS delete_expense: books reversed, row gone, bank transaction back in the review queue'::text;
    else failures := failures || 'FAIL delete_expense plaid'; end if;
  end;

  select pg_temp.bal(uncat) into v;
  perform delete_expense('e3');
  if pg_temp.bal(uncat) = v - 1000 and not exists (select 1 from expenses where id = 'e3') and pg_temp.ents('e3') = 2 and pg_temp.act('e3') = 0
  then results := results || 'PASS delete_expense keeps the history (entry + reversal) and removes the expense'::text; else failures := failures || 'FAIL delete e3'; end if;
  for t in select * from (values
    ('delete an unknown expense',            'P0002', 'select delete_expense(''nope'')'),
    ('delete another user''s expense',       'P0002', 'select delete_expense(''eb1'')')
  ) as v(label, code, s)
  loop
    begin execute t.s; failures := failures || ('FAIL accepted: ' || t.label);
    exception when others then
      if sqlstate = t.code then results := results || ('PASS rejected: ' || t.label); else failures := failures || ('FAIL ' || t.label || ' -> ' || sqlstate); end if;
    end;
  end loop;

  -- ---- invoices: saving posts in the same transaction ----
  perform save_invoice('{"id":"i-d","invoice_number":"900","customer":"ACME","customer_id":"c1","amount":10000,"status":"Draft","invoice_date":"2026-06-02"}', '[]');
  if pg_temp.act('i-d') = 0 and pg_temp.gaps(a) = 0 then results := results || 'PASS a draft invoice posts nothing'::text; else failures := failures || 'FAIL draft posted'; end if;
  perform save_invoice('{"id":"i1","invoice_number":"1001","customer":"ACME","customer_id":"c1","amount":120000,"status":"Sent","invoice_date":"2026-06-01"}',
                       '[{"id":"l1","description":"Haul","amount":120000}]');
  if pg_temp.bal(ar) = 120000 and pg_temp.bal(inc) = 120000 and pg_temp.act('i1') = 1 and pg_temp.gaps(a) = 0
  then results := results || 'PASS save_invoice (Sent) posts Dr A/R / Cr Income atomically'::text; else failures := failures || ('FAIL invoice post ' || pg_temp.bal(ar)); end if;
  perform save_invoice('{"id":"i1","invoice_number":"1001","customer":"ACME","customer_id":"c1","amount":130000,"status":"Sent","invoice_date":"2026-06-01"}',
                       '[{"id":"l1","description":"Haul","amount":130000}]');
  if pg_temp.bal(ar) = 130000 and pg_temp.ents('i1') = 3 and pg_temp.act('i1') = 1
  then results := results || 'PASS editing a sent invoice = reversal + repost'::text; else failures := failures || ('FAIL invoice edit ' || pg_temp.bal(ar)); end if;
  perform save_invoice('{"id":"i1","invoice_number":"1001","customer":"ACME","customer_id":"c1","amount":120000,"status":"Sent","invoice_date":"2026-06-01"}',
                       '[{"id":"l1","description":"Haul","amount":120000}]');
  perform save_invoice('{"id":"i2","invoice_number":"1002","customer":"ACME","customer_id":"c1","amount":30000,"status":"Sent","invoice_date":"2026-06-02"}', '[]');
  perform set_invoice_status('i2', 'Draft');
  if pg_temp.act('i2') = 0 and pg_temp.bal(ar) = 120000 then results := results || 'PASS returning an invoice to Draft reverses its posting'::text; else failures := failures || 'FAIL to draft'; end if;
  perform set_invoice_status('i2', 'Sent');
  if pg_temp.act('i2') = 1 and pg_temp.bal(ar) = 150000 then results := results || 'PASS marking a draft Sent posts it'::text; else failures := failures || 'FAIL to sent'; end if;
  for t in select * from (values
    ('set status Paid directly',         '23514', 'select set_invoice_status(''i1'', ''Paid'')'),
    ('set status Overdue directly',      '23514', 'select set_invoice_status(''i1'', ''Overdue'')'),
    ('send an invoice with no date',     '23514', 'select save_invoice(''{"id":"bad1","invoice_number":"1","customer":"C","amount":100,"status":"Sent"}'', ''[]'')'),
    ('send an invoice for zero dollars', '23514', 'select save_invoice(''{"id":"bad2","invoice_number":"2","customer":"C","amount":0,"status":"Sent","invoice_date":"2026-06-01"}'', ''[]'')'),
    ('line items that do not add up',    '23514', 'select save_invoice(''{"id":"bad3","invoice_number":"3","customer":"C","amount":500,"status":"Sent","invoice_date":"2026-06-01"}'', ''[{"id":"lb","description":"x","amount":400}]'')'),
    ('set status on an unknown invoice', 'P0002', 'select set_invoice_status(''nope'', ''Sent'')')
  ) as v(label, code, s)
  loop
    select (select count(*) from invoices), (select count(*) from invoice_line_items) into n, n2;
    begin execute t.s; failures := failures || ('FAIL accepted: ' || t.label);
    exception when others then
      if sqlstate = t.code and (select count(*) from invoices) = n and (select count(*) from invoice_line_items) = n2 then
        results := results || ('PASS rejected, invoice not half-saved: ' || t.label);
      else failures := failures || ('FAIL ' || t.label || ' -> ' || sqlstate || ' ' || sqlerrm); end if;
    end;
  end loop;

  -- ---- delete_invoice ----
  perform save_invoice('{"id":"i-del","invoice_number":"1003","customer":"ACME","customer_id":"c1","amount":7000,"status":"Sent","invoice_date":"2026-06-03"}', '[{"id":"ld","description":"x","amount":7000}]');
  select pg_temp.bal(ar) into v;
  perform delete_invoice('i-del');
  if pg_temp.bal(ar) = v - 7000 and not exists (select 1 from invoices where id = 'i-del') and not exists (select 1 from invoice_line_items where invoice_id = 'i-del')
     and pg_temp.act('i-del') = 0 and pg_temp.ents('i-del') = 2
  then results := results || 'PASS delete_invoice: posting reversed (history kept), invoice and lines removed'::text; else failures := failures || 'FAIL delete invoice'; end if;

  -- ---- payments + reports ----
  pay := record_payment('c1', '2026-06-20', 60000, chk, '[{"invoice_id":"i1","amount_cents":60000}]');
  begin perform delete_invoice('i1'); failures := failures || 'FAIL deleted an invoice with a payment applied';
  exception when others then
    if sqlstate = '23514' and pg_temp.act('i1') = 1 and exists (select 1 from invoices where id = 'i1') then results := results || 'PASS an invoice with payments applied cannot be deleted (nothing changed)'::text;
    else failures := failures || ('FAIL delete paid invoice ' || sqlstate); end if;
  end;
  perform record_payment('c1', '2026-06-25', 5000, chk, '[]');

  select sum(amount_cents) into v from report_profit_and_loss('2026-06-01', '2026-06-30', 'accrual') where section = 'income';
  select sum(amount_cents) into v2 from report_profit_and_loss('2026-06-01', '2026-06-30', 'cash') where section = 'income';
  if v = 150000 and v2 = 60000 then results := results || 'PASS P&L: accrual income = invoiced (150000), cash income = payments applied (60000)'::text; else failures := failures || ('FAIL P&L income ' || v || '/' || v2); end if;
  select amount_cents into v from report_profit_and_loss('2026-06-01', '2026-06-30', 'cash') where section = 'unapplied';
  if v = 5000 then results := results || 'PASS P&L (cash) shows payments not yet matched to an invoice instead of hiding them'::text; else failures := failures || ('FAIL unapplied row ' || coalesce(v::text, 'null')); end if;
  select coalesce(sum(amount_cents), 0) into v from report_profit_and_loss('2026-06-01', '2026-06-30', 'cash') where section = 'expense';
  select coalesce(sum(amount), 0) into v2 from expenses where date between '2026-06-01' and '2026-06-30';
  if v = v2 and v > 0 then results := results || 'PASS P&L expenses equal the expense records exactly'::text; else failures := failures || ('FAIL P&L expenses ' || v || '/' || v2); end if;
  select coalesce(sum(amount_cents), 0) into v from report_profit_and_loss('2026-07-01', '2026-07-31', 'cash');
  if v = 0 then results := results || 'PASS P&L for an empty month is empty'::text; else failures := failures || 'FAIL empty month'; end if;
  begin perform * from report_profit_and_loss('2026-06-01', '2026-06-30', 'bogus'); failures := failures || 'FAIL bogus basis';
  exception when others then if sqlstate = '22023' then results := results || 'PASS unknown reporting basis is refused'::text; else failures := failures || ('FAIL basis ' || sqlstate); end if; end;

  select coalesce(sum(amount_cents) filter (where section = 'assets'), 0) - coalesce(sum(amount_cents) filter (where section = 'liabilities'), 0),
         coalesce(sum(amount_cents) filter (where section = 'equity'), 0) into v, v2 from report_balance_sheet('2026-06-30');
  if v = v2 and v <> 0 then results := results || 'PASS balance sheet balances: assets - liabilities = equity + profit to date'::text; else failures := failures || ('FAIL balance sheet ' || v || '/' || v2); end if;

  select * into r from dashboard_summary('2026-06-30', '2026-06-01', '2026-06-30');
  select coalesce(sum(amount), 0) into v2 from expenses where date between '2026-06-01' and '2026-06-30';
  if r.cash_available_cents = pg_temp.bal(chk) + pg_temp.bal(sav) and r.money_in_cents = 60000 and r.money_out_cents = v2
     and r.profit_cents = 60000 - v2 and r.waiting_to_be_paid_cents = 90000 and r.overdue_cents = 90000
  then results := results || 'PASS dashboard: cash = real bank balances in the books, money in = payments applied, money out = expenses, waiting/overdue from invoices'::text;
  else failures := failures || ('FAIL dashboard ' || r.cash_available_cents || '/' || r.money_in_cents || '/' || r.money_out_cents || '/' || r.waiting_to_be_paid_cents || '/' || r.overdue_cents); end if;
  select * into r from dashboard_summary('2026-06-15', '2026-06-01', '2026-06-15');
  if r.money_in_cents = 0 and r.waiting_to_be_paid_cents = 150000 and r.overdue_cents = 150000
  then results := results || 'PASS dashboard "as of" dates: a payment dated later is not counted yet'::text; else failures := failures || ('FAIL dashboard as-of ' || r.money_in_cents || '/' || r.waiting_to_be_paid_cents); end if;

  -- ---- database-level consistency for expenses (privileged role: only triggers/constraints stand in the way) ----
  select id into ent from journal_entry_trace where source_id = 'e1' and status = 'active';
  reset role;
  for t in select * from (values
    ('expense amount changed without reposting',   '23514', 'update expenses set amount = amount + 1 where id = ''e1'''),
    ('expense date changed without reposting',     '23514', 'update expenses set date = ''2026-06-20'' where id = ''e1'''),
    ('expense category changed without reposting', '23514', 'update expenses set category = ''Meals'' where id = ''e1'''),
    ('expense category changed to one with no account','23514', 'update expenses set category = ''Income'' where id = ''e1'''),
    ('expense deleted without reversing its entry','23514', 'delete from expenses where id = ''e1'''),
    ('expense re-keyed (old id left posted)',      '23514', 'update expenses set id = ''e1-moved'' where id = ''e1'''),
    ('expense entry reversed behind its back',     '23514', format('select _reverse_entry(%L, %L, ''x'')', a, ent))
  ) as v(label, code, s)
  loop
    begin execute t.s; set constraints all immediate; failures := failures || ('FAIL accepted: ' || t.label);
    exception when others then
      if sqlstate = t.code then results := results || ('PASS DB rejects: ' || t.label); else failures := failures || ('FAIL ' || t.label || ' -> ' || sqlstate || ' ' || sqlerrm); end if;
    end;
    set constraints all deferred;
  end loop;
  insert into expenses (id,user_id,date,vendor,category,amount) values ('gap1', a, '2026-06-14', 'Unposted', 'Fuel', 100);
  if exists (select 1 from ledger_gaps where user_id = a and source_id = 'gap1') then results := results || 'PASS an expense that never reached the books shows up in ledger_gaps'::text;
  else failures := failures || 'FAIL gap not visible'; end if;
  delete from expenses where id = 'gap1';

  select sum(debit_total), sum(credit_total) into v, v2 from account_balances where user_id = a;
  if v = v2 then results := results || 'PASS inv 8: debits = credits'::text; else failures := failures || 'FAIL inv 8'; end if;
  select
    coalesce(sum(balance_cents) filter (where type='asset'),0) - coalesce(sum(balance_cents) filter (where type='liability'),0),
    coalesce(sum(balance_cents) filter (where type='equity'),0) + coalesce(sum(balance_cents) filter (where type='income'),0) - coalesce(sum(balance_cents) filter (where type='expense'),0)
  into v, v2 from account_balances where user_id = a;
  if v = v2 then results := results || 'PASS inv 9/10: assets - liabilities = equity + (income - expenses)'::text; else failures := failures || ('FAIL inv 9 ' || v || '/' || v2); end if;
  if pg_temp.gaps(a) = 0 then results := results || 'PASS nothing that belongs in the books is missing from them (ledger_gaps empty)'::text; else failures := failures || 'FAIL ledger_gaps not empty'; end if;

  -- ---- other users and roles ----
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  set local role authenticated;
  for t in select * from (values
    ('B deleting A''s expense',          'P0002', 'select delete_expense(''e1'')'),
    ('B editing A''s expense',           'P0002', format('select save_expense(''{"id":"e1","date":"2026-06-10","vendor":"x","category":"Fuel","amount":1}'', %L)', b_chk)),
    ('B categorizing A''s bank transaction','P0002', 'select categorize_plaid_transaction(''t6'', ''Fuel'')'),
    ('B deleting A''s invoice',          'P0002', 'select delete_invoice(''i1'')'),
    ('B changing A''s invoice status',   'P0002', 'select set_invoice_status(''i1'', ''Draft'')'),
    ('B saving over A''s invoice id',    'P0002', 'select save_invoice(''{"id":"i1","invoice_number":"x","customer":"x","amount":1,"status":"Draft"}'', ''[]'')'),
    ('B setting a starting balance on A''s account','P0002', format('select set_opening_balance(%L, 5, ''2026-06-01'')', chk)),
    ('B paying an expense from A''s account','23514', format('select save_expense(''{"id":"eb9","date":"2026-06-10","vendor":"x","category":"Fuel","amount":1}'', %L)', chk))
  ) as v(label, code, s)
  loop
    begin execute t.s; failures := failures || ('FAIL accepted: ' || t.label);
    exception when others then
      if sqlstate = t.code then results := results || ('PASS rejected: ' || t.label); else failures := failures || ('FAIL ' || t.label || ' -> ' || sqlstate || ' ' || sqlerrm); end if;
    end;
  end loop;
  perform save_expense('{"id":"eb2","date":"2026-06-12","vendor":"B Shop","category":"Fuel","amount":2000}', b_chk);
  select coalesce(sum(amount_cents), 0) into v from report_profit_and_loss('2026-06-01', '2026-06-30', 'accrual') where section = 'expense';
  select * into r from dashboard_summary('2026-06-30', '2026-06-01', '2026-06-30');
  if v = 2000 and r.money_out_cents = 2000 and r.cash_available_cents = -2000 and r.money_in_cents = 0 and r.waiting_to_be_paid_cents = 0
  then results := results || 'PASS B''s reports and dashboard show only B''s books (and a bank balance may go negative)'::text; else failures := failures || ('FAIL B reports ' || v || '/' || r.cash_available_cents); end if;
  select count(*) into n from expenses where user_id <> auth.uid(); select n + count(*) into n from journal_entries where user_id <> auth.uid();
  if n = 0 then results := results || 'PASS B cannot see A''s expenses or ledger'::text; else failures := failures || 'FAIL B sees A rows'; end if;
  reset role;

  perform set_config('request.jwt.claims', '{"role":"authenticated"}', true);
  set local role authenticated;
  begin perform save_expense('{"id":"u1","date":"2026-06-10","vendor":"v","category":"Fuel","amount":1}', chk); failures := failures || 'FAIL unauth';
  exception when others then if sqlstate = '28000' then results := results || 'PASS not signed in is refused'::text; else failures := failures || ('FAIL unauth ' || sqlstate); end if; end;
  reset role;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  begin perform save_expense('{"id":"u1","date":"2026-06-10","vendor":"v","category":"Fuel","amount":1}', chk); failures := failures || 'FAIL anon';
  exception when insufficient_privilege then results := results || 'PASS anon cannot execute save_expense'::text; end;
  begin perform 1 from report_profit_and_loss('2026-06-01', '2026-06-30'); failures := failures || 'FAIL anon report';
  exception when insufficient_privilege then results := results || 'PASS anon cannot run reports'::text; end;
  reset role;

  -- ---- deleting a user cascades through the new rows and checks ----
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform set_opening_balance(c_chk, 1000, '2026-06-01');
  perform save_expense('{"id":"ec1","date":"2026-06-10","vendor":"C","category":"Fuel","amount":500}', c_chk);
  perform save_invoice('{"id":"ic1","invoice_number":"1","customer":"C","amount":900,"status":"Sent","invoice_date":"2026-06-01"}', '[]');
  reset role;
  begin
    set constraints all immediate; set constraints all deferred;
    delete from auth.users where id = c;
    select count(*) into n from expenses where user_id = c; select n + count(*) into n from invoices where user_id = c;
    select n + count(*) into n from journal_entries where user_id = c; select n + count(*) into n from accounts where user_id = c;
    if n = 0 then results := results || 'PASS deleting a user removes their expenses, invoices and ledger'::text; else failures := failures || 'FAIL user delete left rows'; end if;
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
