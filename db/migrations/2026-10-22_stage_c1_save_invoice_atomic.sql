-- Stage C1 (applied as Supabase migration "stage_c1_save_invoice_atomic").
alter table public.invoice_line_items
  add column service_date date,
  add column quantity numeric(12,3) not null default 1,
  add column rate_cents bigint;
alter table public.invoice_line_items
  add constraint invoice_line_items_quantity_positive check (quantity > 0),
  add constraint invoice_line_items_rate_nonneg check (rate_cents is null or rate_cents >= 0),
  add constraint invoice_line_items_service_date_sane check (service_date is null or service_date between date '2000-01-01' and date '2100-12-31');

-- One atomic save: invoice + line items in a single transaction. Line items are updated in place by their
-- stable ids (no delete-and-reinsert). SECURITY INVOKER: row-level security applies as the signed-in user.
create or replace function public.save_invoice(p_invoice jsonb, p_lines jsonb default '[]'::jsonb)
returns void language plpgsql security invoker set search_path = public, pg_temp as $$
declare u uuid := auth.uid(); inv_id text := p_invoice->>'id'; n int; want int; keep text[];
begin
  if u is null then raise exception 'not signed in' using errcode = '28000'; end if;
  if inv_id is null or btrim(inv_id) = '' then raise exception 'invoice id is required' using errcode = '23514'; end if;
  if jsonb_typeof(coalesce(p_lines, '[]'::jsonb)) <> 'array' then raise exception 'lines must be an array' using errcode = '22023'; end if;

  insert into public.invoices (id, user_id, invoice_number, customer, customer_id, amount, status, invoice_date, terms, due_date,
                               po_number, bol_number, shipper, consignee, freight_description, updated_at)
  values (inv_id, u, p_invoice->>'invoice_number', p_invoice->>'customer', nullif(p_invoice->>'customer_id', ''),
          (p_invoice->>'amount')::int, p_invoice->>'status', nullif(p_invoice->>'invoice_date', '')::date, p_invoice->>'terms',
          nullif(p_invoice->>'due_date', '')::date, p_invoice->>'po_number', p_invoice->>'bol_number', p_invoice->>'shipper',
          p_invoice->>'consignee', p_invoice->>'freight_description', now())
  on conflict (id) do update set
    invoice_number = excluded.invoice_number, customer = excluded.customer, customer_id = excluded.customer_id,
    amount = excluded.amount, status = excluded.status, invoice_date = excluded.invoice_date, terms = excluded.terms,
    due_date = excluded.due_date, po_number = excluded.po_number, bol_number = excluded.bol_number, shipper = excluded.shipper,
    consignee = excluded.consignee, freight_description = excluded.freight_description, updated_at = now()
  where public.invoices.user_id = u;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'invoice not found' using errcode = 'P0002'; end if;

  want := jsonb_array_length(coalesce(p_lines, '[]'::jsonb));
  keep := array(select x->>'id' from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) x);
  delete from public.invoice_line_items where invoice_id = inv_id and user_id = u and not (id = any(keep));

  insert into public.invoice_line_items (id, invoice_id, user_id, description, amount, position, service_date, quantity, rate_cents)
  select x->>'id', inv_id, u, x->>'description', (x->>'amount')::int, (ord - 1)::int,
         nullif(x->>'service_date', '')::date, coalesce((x->>'quantity')::numeric, 1), (x->>'rate_cents')::bigint
  from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) with ordinality as t(x, ord)
  on conflict (id) do update set
    description = excluded.description, amount = excluded.amount, position = excluded.position,
    service_date = excluded.service_date, quantity = excluded.quantity, rate_cents = excluded.rate_cents
  where public.invoice_line_items.invoice_id = inv_id and public.invoice_line_items.user_id = u;

  select count(*) into n from public.invoice_line_items where invoice_id = inv_id and user_id = u;
  if n <> want then raise exception 'a line item id belongs to a different invoice' using errcode = '23505'; end if;
end $$;
revoke all on function public.save_invoice(jsonb, jsonb) from public, anon;
grant execute on function public.save_invoice(jsonb, jsonb) to authenticated;
