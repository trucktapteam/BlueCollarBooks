# Stage A report (2026-10-21)

**Tests:** `npm test` → 14 tests: 9 pass, 5 are known-bug baselines (`todo`) that must flip to passing in later stages.
`tests/sql/tenant_isolation.sql` → 42/42 checks pass (rolled back, no data persisted). Negative control confirmed the old FK let user B write onto user A's invoice.
Live API probe: all 8 `/api` endpoints return 401 (no/bogus token) and 405 (GET); stripe-webhook returns 400 without a signature.

**Known-bug baselines (todo):** income counts drafts/unpaid; Cash Available double-counts; Plaid pending→posted link not stored; pending row hard-deleted; line-item save not atomic.

**Schema changes:** `invoices.due_date`; owner-scoped composite FKs on line items, payments, attachments, receipts, invoice→customer, bank txn→expense, bank txn/bank account→plaid item; CHECKs on status, amounts, dates, invoice number.

**Wipe:** test invoices/expenses/activity/bank transactions deleted (backup in `backups/`, git-ignored). Customers, bank accounts, categories kept; Plaid cursor reset.

**Open blockers:** Plaid `access_token` plaintext (Supabase Vault is installed → feasible, Stage G); Auth leaked-password protection off (dashboard setting); no rate limiting/password reset/inactivity lock.
