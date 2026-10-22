-- Stage C2 (applied as Supabase migrations "stage_c2_invoice_posting" + "stage_c2_fix_consistency_uses_current_row").
-- Reconcile an invoice's ledger entry with the invoice as it stands now. Idempotent.
--   Draft         -> nothing posted (an existing entry is reversed)
--   anything else -> Dr Accounts Receivable / Cr Income for the invoice amount, dated the invoice date
create or replace function public.sync_invoice_posting(p_invoice_id text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  u uuid := auth.uid(); inv public.invoices; act uuid; ar uuid; inc uuid;
  line_n int; line_sum bigint; act_amt bigint; act_date date;
begin
  if u is null then raise exception 'not signed in' using errcode = '28000'; end if;
  perform public.seed_chart_of_accounts(u);
  perform pg_advisory_xact_lock(hashtextextended(u::text || '|invoice|' || p_invoice_id, 1));

  select * into inv from public.invoices where id = p_invoice_id and user_id = u;
  if not found then raise exception 'invoice not found' using errcode = 'P0002'; end if;
  act := public._active_entry(u, 'invoice', inv.id);

  if inv.status = 'Draft' then
    if act is not null then perform public._reverse_entry(u, act, 'Invoice #' || inv.invoice_number || ' returned to draft'); end if;
    return null;
  end if;

  if inv.invoice_date is null then raise exception 'an invoice needs an invoice date before it can be sent' using errcode = '23514'; end if;
  if inv.amount <= 0 then raise exception 'an invoice total must be greater than zero before it can be sent' using errcode = '23514'; end if;
  select count(*), coalesce(sum(amount), 0) into line_n, line_sum from public.invoice_line_items where invoice_id = inv.id and user_id = u;
  if line_n > 0 and line_sum <> inv.amount then
    raise exception 'invoice total % does not match its line items %', inv.amount, line_sum using errcode = '23514';
  end if;

  if act is not null then
    select coalesce(sum(debit_cents), 0), min(e.entry_date) into act_amt, act_date
    from public.journal_lines l join public.journal_entries e on e.id = l.entry_id where l.entry_id = act;
    if act_amt = inv.amount and act_date = inv.invoice_date then return act; end if;   -- already in sync
    perform public._reverse_entry(u, act, 'Invoice #' || inv.invoice_number || ' edited');
  end if;

  select id into ar  from public.accounts where user_id = u and system_key = 'accounts_receivable';
  select id into inc from public.accounts where user_id = u and system_key = 'income';
  return public._post_entry(u, inv.invoice_date, 'Invoice #' || inv.invoice_number || ' - ' || inv.customer, 'invoice', inv.id, jsonb_build_array(
    jsonb_build_object('account_id', ar,  'debit',  inv.amount),
    jsonb_build_object('account_id', inc, 'credit', inv.amount)));
end $$;
revoke all on function public.sync_invoice_posting(text) from public, anon;
grant execute on function public.sync_invoice_posting(text) to authenticated;

-- DB-enforced: a posted invoice can never silently drift from its ledger entry (checked at commit, against the CURRENT row).
create or replace function public.check_invoice_ledger_consistency() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare cur public.invoices; act uuid; amt bigint; d date;
begin
  select * into cur from public.invoices where id = new.id;
  if not found then return null; end if;
  act := public._active_entry(cur.user_id, 'invoice', cur.id);
  if act is null then return null; end if;
  select coalesce(sum(l.debit_cents), 0), min(e.entry_date) into amt, d
  from public.journal_lines l join public.journal_entries e on e.id = l.entry_id where l.entry_id = act;
  if cur.status = 'Draft' or cur.amount <> amt or cur.invoice_date is distinct from d then
    raise exception 'invoice % no longer matches its ledger entry; run sync_invoice_posting in the same save', cur.invoice_number using errcode = '23514';
  end if;
  return null;
end $$;
create constraint trigger invoices_ledger_consistency after insert or update of amount, status, invoice_date on public.invoices
  deferrable initially deferred for each row execute function public.check_invoice_ledger_consistency();

-- DB-enforced: an invoice with an active ledger entry cannot be deleted (reverse it first). Deleting the whole user is fine.
create or replace function public.invoices_block_delete_when_posted() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from auth.users u where u.id = old.user_id)
     and public._active_entry(old.user_id, 'invoice', old.id) is not null then
    raise exception 'invoice % is posted to the books; reverse it before deleting', old.invoice_number using errcode = '23503';
  end if;
  return old;
end $$;
create trigger invoices_block_delete_when_posted before delete on public.invoices
  for each row execute function public.invoices_block_delete_when_posted();

revoke all on function public.check_invoice_ledger_consistency() from public, anon, authenticated;
revoke all on function public.invoices_block_delete_when_posted() from public, anon, authenticated;
