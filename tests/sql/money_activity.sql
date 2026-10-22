-- Stage F4 tests: the corrections list (money_activity) and edit/void through the existing functions.
-- One DO block, always rolls back. Success = message starts 'ROLLED BACK - ALL PASS'.
do $test$
declare
  a uuid := '00000000-0000-4000-8000-0000000000aa';
  b uuid := '00000000-0000-4000-8000-0000000000bb';
  chk uuid; sav uuid; card uuid; tid uuid; oid uuid; lid uuid; lp uuid; rf uuid; pay uuid; v bigint; n int;
  results text[] := '{}'; failures text[] := '{}';
begin
  insert into auth.users (id,email,aud,role) values (a,'ta@example.invalid','authenticated','authenticated'),(b,'tb@example.invalid','authenticated','authenticated');
  insert into plaid_items (id,user_id,item_id,access_token) values ('pi-a',a,'item-a','x');
  insert into bank_accounts (id,user_id,name,last4,balance,last_updated,subtype,plaid_item_id,plaid_account_id) values
    ('bk1',a,'Checking','1111',0,'x',null,'item-a','pa1'),('bk2',a,'Savings','2222',0,'x',null,null,null),('bk3',a,'Visa','3333',0,'x','credit card',null,null),('bkb',b,'B Checking','9999',0,'x',null,null,null);
  insert into expense_categories (user_id,name) values (a,'Fuel');
  insert into customers (id,user_id,name) values ('c1',a,'ACME');
  perform seed_chart_of_accounts(a); perform seed_chart_of_accounts(b);
  select id into chk from accounts where bank_account_id='bk1'; select id into sav from accounts where bank_account_id='bk2'; select id into card from accounts where bank_account_id='bk3';
  insert into plaid_transactions (id,user_id,plaid_item_id,plaid_account_id,date,name,amount,pending) values ('t1',a,'item-a','pa1','2026-06-02','ATM',5000,false);
  execute 'create function pg_temp.bal(p uuid) returns bigint language sql as $f$ select coalesce((select balance_cents from account_balances where account_id = p), 0) $f$';

  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  tid := record_transfer('2026-06-01', 10000, chk, sav, null);
  perform record_card_payment('2026-06-01', 2000, chk, card, null);
  oid := record_owner_draw('2026-06-02', 5000, chk, null);
  perform record_owner_contribution('2026-06-03', 7000, chk, null);
  lid := record_loan('Truck', 'Bank', 100000, '2026-06-04', chk, null, null);
  lp := record_loan_payment(lid, '2026-06-05', 3000, 500, chk, null);
  rf := record_refund('2026-06-06', 1200, chk, 'Fuel', null);
  pay := record_payment('c1', '2026-06-07', 9000, chk, '[]'::jsonb, 'check', null, null);
  perform match_bank_transaction('t1', 'owner_draw', oid::text);

  select count(*) into n from money_activity where voided_at is null;
  if n = 8 and (select count(distinct kind) from money_activity) = 8
  then results := results || 'PASS one list shows transfers, card payments, owner draws/contributions, loans, loan payments, refunds and customer payments'::text; else failures := failures || ('FAIL list ' || n); end if;
  if (select bank_linked from money_activity where id = oid::text) and not (select bank_linked from money_activity where id = tid::text)
  then results := results || 'PASS the list says which items are matched to a bank transaction'::text; else failures := failures || 'FAIL bank_linked'::text; end if;
  if (select interest_cents from money_activity where id = lp::text) = 500 and (select amount_cents from money_activity where id = lp::text) = 3500 and (select category from money_activity where id = rf::text) = 'Fuel'
  then results := results || 'PASS loan payment shows total and interest; refund shows its category'::text; else failures := failures || 'FAIL details'::text; end if;

  select pg_temp.bal(chk), pg_temp.bal(sav) into v, n;
  perform update_transfer(tid, '2026-06-01', 12000, chk, sav, 'fixed');
  if (select amount_cents from money_activity where id = tid::text) = 12000 and pg_temp.bal(chk) = v - 2000 and pg_temp.bal(sav) = n + 2000
  then results := results || 'PASS editing a transfer corrects both accounts (old entry reversed, new one recorded)'::text; else failures := failures || 'FAIL edit transfer'::text; end if;
  perform void_transfer(tid);
  if (select voided_at is not null from transfers where id = tid) and pg_temp.bal(chk) = v + 10000 and pg_temp.bal(sav) = n - 10000 + 2000 - 2000
  then results := results || 'PASS voiding a transfer puts both accounts back'::text; else failures := failures || ('FAIL void transfer ' || pg_temp.bal(chk)); end if;

  begin
    perform update_owner_transaction(oid, '2026-06-02', 5500, chk, null);
    set constraints all immediate;
    failures := failures || 'FAIL edited a matched owner draw amount'::text;
  exception when others then if sqlstate = '23514' then results := results || 'PASS editing the amount of something matched to the bank is refused with a clear reason'::text; else failures := failures || ('FAIL matched edit ' || sqlstate); end if; end;
  set constraints all deferred;
  select pg_temp.bal(chk) into v;
  perform void_loan_payment(lp); perform void_refund(rf); perform void_payment(pay);
  if pg_temp.bal(chk) = v + 3500 - 1200 - 9000 and (select count(*) from money_activity where voided_at is not null) = 4
  then results := results || 'PASS voiding a loan payment, a refund and a customer payment each reverses its own entry'::text; else failures := failures || ('FAIL voids ' || pg_temp.bal(chk)); end if;
  begin perform void_loan(lid); results := results || 'PASS a loan with no payments left can be voided'::text;
  exception when others then failures := failures || ('FAIL void loan ' || sqlerrm); end;

  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  if (select count(*) from money_activity) = 0 then results := results || 'PASS B sees none of A''s activity'::text; else failures := failures || 'FAIL B reads'::text; end if;
  begin perform void_transfer(tid); failures := failures || 'FAIL B voided A transfer'::text;
  exception when others then if sqlstate = 'P0002' then results := results || 'PASS B cannot void A''s entries'::text; else failures := failures || ('FAIL B void ' || sqlstate); end if; end;
  reset role;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  set local role anon;
  begin perform 1 from money_activity; failures := failures || 'FAIL anon read'::text;
  exception when insufficient_privilege then results := results || 'PASS anon cannot read the activity list'::text; end;
  reset role;

  if array_length(failures,1) is null then
    raise exception 'ROLLED BACK - ALL PASS (% checks)', array_length(results,1);
  else
    raise exception 'ROLLED BACK - % FAILURES: %', array_length(failures,1), array_to_string(failures,' | ');
  end if;
end
$test$;
