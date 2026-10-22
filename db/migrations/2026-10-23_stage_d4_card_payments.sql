-- Stage D4 (applied as Supabase migration "stage_d4_card_payments").
-- Credit-card purchases already post as expenses with the card as "Paid from" (Stage B): Dr expense / Cr card liability.
-- Paying the card is NOT an expense: Dr card liability / Cr bank. It is stored as a transfers row of kind 'card_payment',
-- so edit/void/consistency are the same machinery as transfers. Paying more than the balance is allowed (the card shows a credit).

create or replace function public.record_card_payment(p_date date, p_amount_cents bigint, p_from_account_id uuid, p_card_account_id uuid, p_notes text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'not signed in' using errcode = '28000'; end if;
  perform public.seed_chart_of_accounts(u);
  return public._write_transfer(u, null, 'card_payment', p_date, p_amount_cents, p_from_account_id, p_card_account_id, p_notes);
end $$;
revoke all on function public.record_card_payment(date,bigint,uuid,uuid,text) from public, anon;
grant execute on function public.record_card_payment(date,bigint,uuid,uuid,text) to authenticated;

-- The database (not just the API) enforces what each kind of transfer may connect.
create or replace function public._check_transfer(p_id uuid)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare t public.transfers; f public.accounts; g public.accounts;
begin
  select * into t from public.transfers where id = p_id;
  if not found then return; end if;
  select * into f from public.accounts where id = t.from_account_id;
  select * into g from public.accounts where id = t.to_account_id;
  if f.type <> 'asset' or f.system_key is not null or f.bank_account_id is null then
    raise exception 'money can only be moved out of a bank account' using errcode = '23514';
  end if;
  if t.kind = 'transfer' and (g.type <> 'asset' or g.system_key is not null or g.bank_account_id is null) then
    raise exception 'a transfer must go to another bank account' using errcode = '23514';
  end if;
  if t.kind = 'card_payment' and (g.type <> 'liability' or g.system_key is not null or g.bank_account_id is null) then
    raise exception 'a card payment must go to a credit card account' using errcode = '23514';
  end if;
  perform public._check_event(t.user_id, 'transfer', t.id::text, t.voided_at is null, t.transfer_date,
    jsonb_build_object(t.to_account_id::text, t.amount_cents), jsonb_build_object(t.from_account_id::text, t.amount_cents));
end $$;
