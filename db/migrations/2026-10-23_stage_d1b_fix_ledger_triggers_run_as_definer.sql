-- Stage D1b (applied as Supabase migration "stage_d1_fix_ledger_triggers_run_as_definer").
-- BUG FOUND BY THE D1 TESTS: deferred ledger triggers fire at COMMIT as the signed-in role (authenticated).
-- journal_validate_from_entry/_line were SECURITY INVOKER and call validate_journal_entry, whose EXECUTE was revoked
-- from app roles in the Stage B hardening. Result: any real commit that posted a ledger entry would have failed with 42501.
-- Earlier suites did not notice because they forced the deferred checks AFTER resetting to the owner role.
-- Fix: run these internal trigger functions as owner. New regression check: transfers.sql forces the deferred
-- checks while still acting as the signed-in role.
alter function public.validate_journal_entry(uuid) security definer;
alter function public.journal_validate_from_entry() security definer;
alter function public.journal_validate_from_line() security definer;
alter function public.ledger_immutable() security definer;
alter function public.ledger_no_truncate() security definer;
