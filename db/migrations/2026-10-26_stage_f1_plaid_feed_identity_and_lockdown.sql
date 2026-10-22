-- Stage F1: the bank feed keeps one real-world transaction as one row (pending -> posted), and users can no longer
-- write bank-feed or bank-account rows directly.
--
-- Pending -> posted: Plaid sends the posted transaction as `added` (with pending_transaction_id) and the pending one as
-- `removed`. We used to hard-delete the pending row, so a charge the user had already handled came back as a brand-new
-- one. Now the pending row is kept, marked `superseded`, and whatever the user did to it moves to the posted row.
-- A removed transaction is marked `removed`, never deleted.

alter table public.plaid_transactions
  add column pending_transaction_id text,
  add column status text not null default 'active' check (status in ('active', 'superseded', 'removed')),
  add column superseded_by text,
  add column review_state text not null default 'open' check (review_state in ('open', 'unsure')),
  add column review_note text,
  add constraint plaid_transactions_id_user_unique unique (id, user_id),
  add constraint plaid_transactions_superseded_by_check check (superseded_by is null or status = 'superseded'),
  add constraint plaid_transactions_superseded_by_fkey foreign key (superseded_by, user_id)
    references public.plaid_transactions (id, user_id) deferrable initially deferred;
create index plaid_transactions_pending_ref_idx on public.plaid_transactions (user_id, pending_transaction_id) where pending_transaction_id is not null;
create index plaid_transactions_active_idx on public.plaid_transactions (user_id, date desc) where status = 'active';

-- Users read their feed; only the server (service role) and the functions below write it.
drop policy if exists "own rows" on public.plaid_transactions;
create policy plaid_transactions_select_own on public.plaid_transactions for select to authenticated using (auth.uid() = user_id);
revoke all on public.plaid_transactions from public, anon, authenticated;
grant select on public.plaid_transactions to authenticated;

-- Bank accounts carry the Plaid linkage (which Plaid account is which); the server owns them.
drop policy if exists "own rows" on public.bank_accounts;
create policy bank_accounts_select_own on public.bank_accounts for select to authenticated using (auth.uid() = user_id);
revoke all on public.bank_accounts from public, anon, authenticated;
grant select on public.bank_accounts to authenticated;

-- ===== moving a handled pending transaction onto the posted one =====
create or replace function public._supersede_pending(p_user uuid, p_pending text, p_posted text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.plaid_transactions; x public.plaid_transactions;
begin
  if p_pending is null or p_pending = p_posted then return; end if;
  select * into p from public.plaid_transactions where id = p_pending and user_id = p_user for update;
  if not found then return; end if;
  select * into x from public.plaid_transactions where id = p_posted and user_id = p_user for update;
  if not found then return; end if;
  if p.status = 'superseded' and p.superseded_by = p_posted then return; end if;
  -- whatever the user already decided travels to the posted row
  update public.plaid_transactions set
      excluded = x.excluded or p.excluded,
      review_state = case when x.review_state = 'unsure' or p.review_state = 'unsure' then 'unsure' else 'open' end,
      review_note = coalesce(x.review_note, p.review_note),
      category = coalesce(x.category, p.category),
      expense_id = null
   where id = p.id;
  update public.plaid_transactions set
      excluded = x.excluded or p.excluded,
      review_state = case when x.review_state = 'unsure' or p.review_state = 'unsure' then 'unsure' else 'open' end,
      review_note = coalesce(x.review_note, p.review_note),
      category = coalesce(x.category, p.category),
      expense_id = coalesce(x.expense_id, p.expense_id)
   where id = x.id;
  update public.plaid_transactions set status = 'superseded', superseded_by = x.id, excluded = false, review_state = 'open', category = null, updated_at = now()
   where id = p.id;
end $$;

create or replace function public._remove_plaid_txn(p_user uuid, p_id text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare p public.plaid_transactions; x text;
begin
  select * into p from public.plaid_transactions where id = p_id and user_id = p_user for update;
  if not found or p.status <> 'active' then return; end if;
  select id into x from public.plaid_transactions where user_id = p_user and pending_transaction_id = p.id and status = 'active' limit 1;
  if x is not null then perform public._supersede_pending(p_user, p.id, x); return; end if;
  update public.plaid_transactions set status = 'removed', updated_at = now() where id = p.id;
end $$;

-- ===== one atomic write per Plaid page (server only) =====
create or replace function public.apply_plaid_sync_page(p_user uuid, p_item text, p_added jsonb, p_modified jsonb, p_removed jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare r jsonb; rid text; n int; up int := 0; rm int := 0;
begin
  if not exists (select 1 from public.plaid_items where item_id = p_item and user_id = p_user) then
    raise exception 'unknown bank connection for this user' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('plaid|' || p_user::text, 0));

  for r in select * from jsonb_array_elements(coalesce(p_added, '[]'::jsonb) || coalesce(p_modified, '[]'::jsonb)) loop
    insert into public.plaid_transactions (id, user_id, plaid_item_id, plaid_account_id, date, name, merchant_name, amount, pending,
                                           plaid_category, pending_transaction_id, updated_at)
    values (r->>'id', p_user, p_item, r->>'plaid_account_id', (r->>'date')::date, r->>'name', r->>'merchant_name', (r->>'amount')::int,
            coalesce((r->>'pending')::boolean, false), r->>'plaid_category', nullif(r->>'pending_transaction_id', ''), now())
    on conflict (id) do update set
      plaid_account_id = excluded.plaid_account_id, date = excluded.date, name = excluded.name, merchant_name = excluded.merchant_name,
      amount = excluded.amount, pending = excluded.pending, plaid_category = excluded.plaid_category,
      pending_transaction_id = coalesce(excluded.pending_transaction_id, public.plaid_transactions.pending_transaction_id),
      status = case when public.plaid_transactions.status = 'removed' then 'active' else public.plaid_transactions.status end,
      updated_at = now()
    where public.plaid_transactions.user_id = p_user and public.plaid_transactions.plaid_item_id = p_item;
    get diagnostics n = row_count;
    if n = 0 then raise exception 'transaction id already belongs to another connection' using errcode = '23505'; end if;
    up := up + 1;
    perform public._supersede_pending(p_user, nullif(r->>'pending_transaction_id', ''), r->>'id');
  end loop;

  for rid in select jsonb_array_elements_text(coalesce(p_removed, '[]'::jsonb)) loop
    perform public._remove_plaid_txn(p_user, rid);
    rm := rm + 1;
  end loop;
  return jsonb_build_object('upserted', up, 'removed', rm);
end $$;

-- ===== the user's own review actions (no direct writes) =====
create or replace function public.exclude_bank_transaction(p_id text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := auth.uid(); t public.plaid_transactions;
begin
  if u is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select * into t from public.plaid_transactions where id = p_id and user_id = u for update;
  if not found then raise exception 'transaction not found' using errcode = 'P0002'; end if;
  if t.status <> 'active' then raise exception 'this transaction is no longer in your bank feed' using errcode = '23514'; end if;
  if t.expense_id is not null then raise exception 'this transaction is already recorded; undo that first' using errcode = '23514'; end if;
  update public.plaid_transactions set excluded = true, review_state = 'open', updated_at = now() where id = t.id;
end $$;

create or replace function public.restore_bank_transaction(p_id text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := auth.uid(); t public.plaid_transactions;
begin
  if u is null then raise exception 'not signed in' using errcode = '28000'; end if;
  select * into t from public.plaid_transactions where id = p_id and user_id = u for update;
  if not found then raise exception 'transaction not found' using errcode = 'P0002'; end if;
  update public.plaid_transactions set excluded = false, updated_at = now() where id = t.id;
end $$;

do $$
declare f text;
begin
  foreach f in array array['_supersede_pending(uuid,text,text)', '_remove_plaid_txn(uuid,text)', 'apply_plaid_sync_page(uuid,text,jsonb,jsonb,jsonb)']
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  execute 'grant execute on function public.apply_plaid_sync_page(uuid,text,jsonb,jsonb,jsonb) to service_role';
  foreach f in array array['exclude_bank_transaction(text)', 'restore_bank_transaction(text)']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
