# Stage C Report: Invoices, Payments, A/R

Status: complete, stopped for review. Stage D not started.

## 1. Schema added/changed (commits 2e48aff, a87fde5, ae664bf, 7f7766f)
- C1: `invoice_line_items` gains `service_date`, `quantity`, `rate_cents` (CHECKs). `save_invoice(invoice, lines)` saves header + lines in one transaction (SECURITY INVOKER, syncs lines in place by id). `saveInvoice` in the app now makes one `rpc('save_invoice')` call.
- C2: `sync_invoice_posting(invoice_id)`: Draft posts nothing; non-Draft posts Dr A/R / Cr Income on the invoice date; edits = reversal + repost; idempotent. Deferred trigger `invoices_ledger_consistency`; `invoices_block_delete_when_posted`.
- C3: tables `payments`, `payment_applications` (composite FKs, RLS select-own). API: `record_payment`, `update_payment`, `void_payment`. Posting: Dr deposit account / Cr A/R.
- C4 (read-only, SECURITY INVOKER): `invoice_balances_as_of`, `invoice_balances`, `ar_aging_as_of`, `ar_aging`, `payment_balances`, `ar_reconciliation_as_of`.

## 2. Invariants now enforced by the database
- Invoice posting matches the invoice's current amount and date; Drafts have no active entry.
- Invariant 7: applications <= payment amount; applications <= invoice amount; applied invoices must be posted; customer must match; a live payment has exactly one active matching entry; a voided payment has none and no applications.
- A posted invoice or live payment cannot be deleted; an invoice with applications cannot be un-posted or cut below what is applied.
- A payment never creates income.

## 3. Tests (all run against the committed files, final state)
| Suite | Result |
|---|---|
| tenant_isolation | 42/42 |
| ledger_core | 43/43 |
| ledger_posting | 37/37 |
| invoice_save | 12/12 |
| invoice_posting | 19/19 |
| payments | 48/48 |
| ar_views | 14/14 |
| `npm test` | 14 tests: 10 pass, 0 fail, 4 todo (known-bug baselines) |

Production after runs: 0 leftover test users; accounts, journal_entries, journal_lines, invoices, expenses, payments, payment_applications all 0; customers 4, bank_accounts 4, categories 18 (unchanged); no stray temp functions.

## 4. Mapping to the ledger
- Invoice (non-Draft) -> `invoice:<id>`: Dr Accounts Receivable / Cr Income, dated invoice date.
- Payment -> `payment:<id>`: Dr deposit account / Cr Accounts Receivable. Unapplied payments remain a customer credit in A/R.
- Derived statuses (Paid, Overdue, Due Today, Sent, Not posted, Draft) and aging come from the views, not stored.

## 5. Unexpected / flags
- Shadow ledger: the app does NOT yet call `sync_invoice_posting`, `record_payment`, etc. The old `invoice_payments` table and `receiveInvoicePayment` remain live until Stage E. Only `saveInvoice` -> `save_invoice` changed in app code. Dashboard and reports untouched.
- A payment needs a "Deposited to" real account (same rule as manual expense "Paid from"). No fake holding account. The UI lacks this field today.
- Bug found and fixed: the deferred consistency trigger judged a stale queued row; it now re-reads the current row.
- Internal functions were executable by signed-in users; revoked.
- Category / system-account name collision is deferred to the category stage (plan section 10).
- Views use `current_date` (UTC); `as_of` parameters exist for deterministic tests.
- Not testable in the sandbox: Expo web build. The first Vercel deploy confirms it. The pushed app now depends on the live DB function `save_invoice`.
- Thomas must `git push` the commits.
- Stage G still needs: Plaid token encryption, password reset, inactivity lock, rate limiting, leaked-password protection toggle.

## 6. Do Stages D-G still hold?
Yes. No conflict between the ledger model and existing invoice/payment workflows. The one UI-dependent item is the Deposited-to / Paid-from field, to be added when the workflows are wired (Stage E).
