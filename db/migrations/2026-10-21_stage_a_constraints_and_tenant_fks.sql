-- Applied to production via Supabase migration "stage_a_constraints_and_tenant_fks"
-- (+ "invoices_due_date", "drop_expenses_vendor_not_blank"). Kept here for review/history.
alter table public.invoices add column if not exists due_date date;

alter table public.invoices    add constraint invoices_id_user_unique    unique (id, user_id);
alter table public.expenses    add constraint expenses_id_user_unique    unique (id, user_id);
alter table public.customers   add constraint customers_id_user_unique   unique (id, user_id);
alter table public.plaid_items add constraint plaid_items_item_user_unique unique (item_id, user_id);

-- Composite FKs: a child can only reference a parent owned by the same user.
alter table public.invoice_line_items drop constraint invoice_line_items_invoice_id_fkey;
alter table public.invoice_line_items add constraint invoice_line_items_invoice_owner_fkey foreign key (invoice_id, user_id) references public.invoices (id, user_id) on delete cascade;
alter table public.invoice_payments drop constraint invoice_payments_invoice_id_fkey;
alter table public.invoice_payments add constraint invoice_payments_invoice_owner_fkey foreign key (invoice_id, user_id) references public.invoices (id, user_id) on delete cascade;
alter table public.invoice_attachments drop constraint invoice_attachments_invoice_id_fkey;
alter table public.invoice_attachments add constraint invoice_attachments_invoice_owner_fkey foreign key (invoice_id, user_id) references public.invoices (id, user_id) on delete cascade;
alter table public.expense_receipts drop constraint expense_receipts_expense_id_fkey;
alter table public.expense_receipts add constraint expense_receipts_expense_owner_fkey foreign key (expense_id, user_id) references public.expenses (id, user_id) on delete cascade;
alter table public.invoices drop constraint invoices_customer_id_fkey;
alter table public.invoices add constraint invoices_customer_owner_fkey foreign key (customer_id, user_id) references public.customers (id, user_id) on delete set null (customer_id);
alter table public.plaid_transactions drop constraint plaid_transactions_expense_id_fkey;
alter table public.plaid_transactions add constraint plaid_transactions_expense_owner_fkey foreign key (expense_id, user_id) references public.expenses (id, user_id) on delete set null (expense_id);
alter table public.plaid_transactions drop constraint plaid_transactions_plaid_item_id_fkey;
alter table public.plaid_transactions add constraint plaid_transactions_item_owner_fkey foreign key (plaid_item_id, user_id) references public.plaid_items (item_id, user_id) on delete cascade;
alter table public.bank_accounts drop constraint bank_accounts_plaid_item_id_fkey;
alter table public.bank_accounts add constraint bank_accounts_item_owner_fkey foreign key (plaid_item_id, user_id) references public.plaid_items (item_id, user_id);

-- CHECK constraints
alter table public.invoices
  add constraint invoices_status_valid check (status in ('Draft','Sent','Due Today','Overdue','Paid')),
  add constraint invoices_amount_nonneg check (amount >= 0),
  add constraint invoices_number_not_blank check (length(btrim(invoice_number)) > 0),
  add constraint invoices_date_sane check (invoice_date is null or invoice_date between date '2000-01-01' and date '2100-12-31'),
  add constraint invoices_due_not_before_date check (due_date is null or invoice_date is null or due_date >= invoice_date);
alter table public.invoice_line_items add constraint invoice_line_items_position_nonneg check (position >= 0);
alter table public.invoice_payments
  add constraint invoice_payments_amount_positive check (amount > 0),
  add constraint invoice_payments_date_sane check (payment_date is null or payment_date between date '2000-01-01' and date '2100-12-31');
alter table public.expenses
  add constraint expenses_amount_nonneg check (amount >= 0),
  add constraint expenses_date_sane check (date is null or date between date '2000-01-01' and date '2100-12-31');
alter table public.invoice_attachments add constraint invoice_attachments_size_nonneg check (size is null or size >= 0);
alter table public.expense_receipts   add constraint expense_receipts_size_nonneg   check (size is null or size >= 0);
