-- Stage F5: signed-in users can no longer call the low-level posting functions directly.
-- They post to the ledger with arbitrary accounts/amounts and bypass the workflow checks (source tracing, bank matching,
-- event validation). The app only needs the workflow functions (save_expense, record_*, resolve_bank_transaction, ...),
-- which call these internally as SECURITY DEFINER.
revoke all on function public.post_expense(text, uuid) from public, anon, authenticated;
revoke all on function public.repost_expense(text, uuid) from public, anon, authenticated;
revoke all on function public.post_opening_balance(uuid, bigint, date) from public, anon, authenticated;
revoke all on function public.reverse_journal_entry(uuid, text) from public, anon, authenticated;
revoke all on function public.reverse_active_entry(text, text, text) from public, anon, authenticated;
revoke all on function public.sync_invoice_posting(text) from public, anon, authenticated;
revoke all on function public.ensure_chart_of_accounts() from public, anon, authenticated;
