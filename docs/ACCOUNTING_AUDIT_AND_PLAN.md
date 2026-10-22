# BCB Accounting Foundation: Audit and Implementation Plan

Written October 21, 2026, in response to the Master Product & Implementation Brief (section 35).
Nothing in this document has been implemented. It is the audit, the proposed migration path, and the commit plan, for review before any code is written.

---

## 1. Verdict

The brief's diagnosis is correct. BCB today is a well-built **income/expense tracker**, not an accounting system:

- There is no ledger. Every dashboard and report number is computed in the browser by adding up rows from separate tables (`invoices`, `expenses`, `bank_accounts`).
- Three different parts of the app can disagree about the same dollar, and nothing reconciles them.
- Every write goes straight from the browser to Supabase, one table at a time, with no transaction around multi-step changes.

The good news is timing. **Production holds only test data** (5 invoices, 6 expenses, 24 bank transactions, 4 customers, 0 payments). Nothing real is in BCB yet, so this is the cheapest moment to change the schema. Migration risk is low *now* and rises sharply once LFR data goes in.

---

## 2. What stays exactly as it is

All of this is compatible with a ledger and should not be touched:

- Authentication (Supabase Auth), session handling, sign-in/out, the Coming Soon waitlist flow and its RLS.
- Stripe: Checkout, webhook (signature verification confirmed in `api/stripe-webhook.ts`), portal, subscription gating.
- Plaid: link, exchange, balance refresh, disconnect, reauth handling. Access tokens stay server-side (`plaid_items` has RLS on with zero client policies, so the browser can never read them).
- Stable text/UUID ids, integer cents everywhere, ISO dates, shared date/money utils.
- Customers (with permanent ids), invoice and expense attachments, receipt storage, CSV/backup export.
- All UI, branding, mobile layout, marketing site, ads.
- Unique invoice numbers per user (added October 14).

---

## 3. Current data flow and where it breaks the brief

| Brief requirement | What exists today | Problem |
|---|---|---|
| Double-entry ledger | None | Whole foundation missing |
| Cash Available from trustworthy balances | `dashboard.tsx:71`: `bank balances + paid this month - money out` | **Confirmed double count.** The Plaid bank balance already includes this month's deposits and spending, and then they are added/subtracted again |
| Revenue respects a reporting basis | `reports.tsx:68` and `dashboard.tsx:63`: sum of `invoice.amount` for every invoice dated in the period | **Drafts and unpaid invoices count as income.** No basis is chosen on purpose |
| Terms and due dates persist | Terms field exists on the form and the column exists, but the save in `new-invoice.tsx` never includes `terms` in what it saves | **Still broken.** Terms silently never save, so due dates and "overdue" are computed from a default |
| Payments as first-class objects | `invoice_payments` is a child row of exactly one invoice | Cannot apply one payment to several invoices, cannot hold an unapplied remainder, cannot later match a bank deposit |
| Invoice paid status | Stored as text (`status = 'Paid'`), can be set by hand | Status is an opinion, not derived from payments. "Mark paid" with no payment is possible |
| Deposits | `getTransactionsNeedingReview` only shows `amount > 0` (money out) | **Money in is never reviewed**, so deposits can never be matched to payments |
| Transfers, loans, owner draws/contributions, credit-card payments, equipment | None. The only tool is "Not a business expense", which throws the transaction away | Cannot represent any of them. A $15k financed trailer can only be an expense or ignored |
| Manual expense + bank transaction duplicate | `categorizeTransaction` always creates a **new** expense | Typing an expense and later categorizing the same bank transaction creates two expenses |
| Plaid pending to posted | Sync upserts by Plaid `transaction_id` and deletes `removed` ids. `pending_transaction_id` is not stored | **Real duplicate bug.** Plaid gives the posted version a new id and removes the pending one. If the pending row was already categorized, the delete drops the link (the expense survives), then the posted row arrives uncategorized and gets categorized again: two expenses |
| Corrections keep history | Invoice save deletes all line items and re-inserts them. Expenses are overwritten in place. `activity_log` is free-text messages | History is destroyed on every edit. No audit trail |
| Atomic multi-step writes | `saveInvoice` = upsert invoice, delete items, insert items, from the browser | A failure midway leaves a half-saved invoice. A ledger can never be written this way |
| Bank balances vs books | `bank_accounts.balance` is overwritten by each Plaid refresh | Fine as "what the bank says", wrong as "what the books say" |

Money formatting, date parsing, invoice numbering, and the customer/invoice identity model are in good shape.

---

## 4. Security and correctness audit (launch blocker, brief section 24)

**Verified good**
- RLS is enabled on all 15 public tables. Every user-owned table has a single "own rows" policy (`auth.uid() = user_id`, both `USING` and `WITH CHECK`).
- Anonymous role has no write grants anywhere except the intentional waitlist INSERT.
- Stripe webhook verifies signatures against the raw body.
- Plaid tokens and the service-role key are only used in server routes.
- No database triggers or functions in `public` that could bypass RLS.

**Gaps found**
1. **Cross-tenant references on child tables.** `invoice_payments`, `invoice_line_items`, `invoice_attachments`, `expense_receipts` and `plaid_transactions.expense_id` reference parent rows by `id` only. A foreign key check ignores RLS, so a signed-in user could insert a row with their own `user_id` pointing at *another user's* invoice id (if they ever learned it). Fix: composite foreign keys `(parent_id, user_id)`.
2. **No CHECK constraints at all.** Nothing enforces valid invoice status, non-negative amounts, or valid dates at the database level; only the app does.
3. **No password reset flow** in the app.
4. **No inactivity lock.**
5. **No rate limiting** on the Vercel API routes (Supabase Auth has its own built-in limits; custom routes have none).
6. **Plaid `access_token` is stored as plain text** (server-only access, but encrypting it, for example with Supabase Vault, is cheap insurance).
7. **No automated tests of any kind.** There is no test runner or test file in the repo, only a lint script.

The brief's two-user isolation test (UI, direct API calls, direct Supabase calls) has not been run yet and is scheduled below.

---

## 5. Proposed architecture: the minimum safe path

### 5.1 Principles
- **The ledger is the single source of truth.** Everything else (dashboard, reports, A/R, cash) is a *view* of it.
- **Posted ledger lines are immutable.** No UPDATE or DELETE. Corrections are new reversing entries that point back at the original. This gives the audit trail for free.
- **All posting happens inside Postgres functions**, one transaction per business event, so a half-posted event is impossible. The browser never inserts ledger rows directly.
- **Existing tables stay as the "source documents"** (invoice, expense, payment, bank transaction). Each posts one journal entry and keeps a pointer to it. This is how we avoid a rewrite.

### 5.2 New tables
- `accounts`: per-user chart of accounts. Types: asset, liability, equity, income, expense. Seeded automatically per user with plain-language names: bank accounts (one per connected or manual account), Accounts Receivable, one liability account per loan ("Loan - <name>"; the generic Loans Payable / Credit Cards Payable accounts were removed in Stage D5 because every loan and card has its own account), Equipment, Owner Contributions, Owner Draws, Opening Balance Equity, Income, and the existing expense categories as expense accounts. A `system_key` marks accounts the engine depends on so users cannot delete them.
- `journal_entries`: id, user_id, entry_date, memo, `source_type` and `source_id` (invoice, payment, expense, bank_transaction, transfer, loan_payment, opening_balance, manual), `reverses_entry_id`, created_at.
- `journal_lines`: entry_id, user_id, account_id, debit_cents, credit_cents (exactly one non-zero, both ≥ 0).
- A **deferred constraint trigger** rejects any entry whose debits do not equal its credits. This one rule is the backbone of everything.
- `payments` and `payment_applications`: a payment (customer, date, amount, deposit account) applied to one or many invoices, with the unapplied remainder tracked. Replaces `invoice_payments`.
- `loans` and `fixed_assets`: liability and asset records (principal, optional rate, linked asset). Depreciation is deliberately **not** computed (tax treatment is the preparer's call, per the brief).
- `reconciliations`: account, statement date, statement balance, cleared lines.

### 5.3 Changes to existing tables
- `invoices`: add `due_date`; persist `terms` (fix the bug); stop trusting stored `status`/`amount` as truth (derive balance and status from lines and applications). Line items gain `service_date`, `quantity`, `rate`.
- `invoice_line_items`: stop delete-and-reinsert; update in place keyed by their existing stable ids.
- `bank_accounts`: link to a ledger account; `balance` becomes "bank-reported balance", used only for reconciliation.
- `plaid_transactions`: add `pending_transaction_id`, `resolution_type` (payment match, expense, transfer, loan, owner, ignored), a link to the journal entry, and a supersede marker. Never hard-delete a row that has been resolved.

### 5.4 How each real-world event posts

| Event | Posting (debit / credit) | Never |
|---|---|---|
| Invoice sent | A/R / Income | Draft invoices post nothing |
| Customer payment received | Bank account / A/R | No second income |
| Bank deposit matches a known payment | Marks the payment as bank-cleared | Creates no entry and no revenue |
| Expense | Expense account / Bank (or Credit Card) | |
| Transfer between own accounts | Bank B / Bank A | Not income or expense |
| Loan proceeds | Bank / that loan's own liability account | Not income |
| Loan payment | That loan's liability account (principal) + Interest Expense / Bank | Principal is not an expense |
| Owner draw | Owner Draws / Bank | Not an expense |
| Owner contribution | Bank / Owner Contributions | Not income |
| Equipment purchase, any mix of funding (bank, card, paid personally, new financing) | Equipment (full cost) / each funding source, ONE entry (D5) | Not a full-price expense |
| Credit-card purchase then card payment | Expense / Card Payable, then Card Payable / Bank | Expense counted once |
| Opening balance | Account / Opening Balance Equity | |

This mirrors the "Undeposited Funds" lesson from LFR: **a payment is deposited to a real bank account and a bank-feed deposit is matched to it, never posted again.** There is no Undeposited Funds account in BCB, so that failure mode cannot be created in the first place.

### 5.5 Reporting basis (decision needed)
The ledger will be accrual-based internally (A/R and income recognized when an invoice is sent). The question is what the **default P&L** shows. See open decisions below.

### 5.6 Calculations to retire or rewrite
- `calculateInvoiceTotal` as "money in" (dashboard and reports): retire, replaced by ledger income.
- `calculatePaidInvoiceTotal`: retire.
- `calculateTotalMonthlyExpenses`: replace with a ledger query.
- Dashboard Cash Available formula (`dashboard.tsx:71`): replace with the sum of ledger bank-account balances.
- `calculateWaitingToBePaidTotal` / `calculateInvoiceBalance`: keep the idea, rewrite to read payment applications.
- `invoice_payments` table and `receiveInvoicePayment`: replaced by `payments` + `payment_applications`.
- `categorizeTransaction` (always makes a new expense): replaced by a resolve-transaction flow that matches first.
- Free-text `activity_log`: stays as a UX feed, but is no longer treated as the audit trail.

---

## 6. Destructive and data-migration risks

| Risk | Severity | Mitigation |
|---|---|---|
| Replacing `invoice_payments` | Low now (0 rows) | Create new tables, migrate any rows (none), drop old ones in a later commit |
| Existing 5 invoices, 6 expenses and 4 bank accounts need ledger entries | Low (test data) | One-time backfill function; verify the ledger totals equal the old totals before cutover. Alternatively wipe test data and start clean |
| Numbers on screen change when the dashboard moves to the ledger | Expected | These are the corrections the brief calls for. Document before/after for the current test data |
| Posting must be atomic | High if done wrong | All posting in Postgres functions, never client-side multi-step writes |
| New tables need correct RLS from day one | High | Every new table gets RLS + the two-user test before use |
| LFR import later | Deferred | Do not build the importer until this model is stable (brief section 28) |
| Offline/legacy browser state | Low | Nothing stored locally any more |

No existing production-quality code needs to be discarded. The existing stores become thin readers/writers around the new functions.

---

## 7. Accounting invariants (written before any posting code)

These become automated tests. The database should enforce the first group itself.

**Enforced by the database**
1. Every journal entry's debits equal its credits.
2. A line has exactly one of debit or credit, never negative.
3. Posted lines cannot be updated or deleted.
4. A line's account and entry belong to the same user.
5. A reversal entry exactly negates the entry it reverses.
6. Invoice numbers are unique per user (already enforced).
7. Payment applications never exceed the payment amount or the invoice balance.

**Verified by scenario tests**
8. Sum of all debits equals sum of all credits, per user, always.
9. Balance sheet balances: Assets = Liabilities + Equity.
10. Net P&L equals the change in equity from income and expenses only.
11. Bank deposit matched to an existing payment creates zero new income.
12. Manual expense then the same bank transaction: one expense, not two.
13. Plaid pending then posted: one economic transaction.
14. Transfer between own accounts: zero P&L effect.
15. Loan received: zero P&L effect. Loan payment: principal does not hit P&L, interest does.
16. Owner draw and contribution: zero P&L effect.
17. Financed equipment: asset and liability recorded, no full-price expense.
18. Credit-card purchase then payment: expense counted once.
19. Invoice created today for service last month: invoice date and service date stay distinct.
20. Draft invoices post nothing.
21. User A can never read or write any of User B's rows (UI, API, direct database).

---

## 8. Implementation plan: small, reviewable commits

Each step is independently reviewable and leaves the app working.

**Stage A: known bugs and safety nets (no architecture change)**
1. Persist invoice `terms` and add `due_date` (fixes the overdue bug).
2. Add database CHECK constraints (status values, non-negative amounts).
3. Composite foreign keys on child tables (cross-tenant integrity).
4. Test harness: add a test runner plus a database test setup that can run the invariant and isolation tests.
5. Two-user isolation test: UI, API, and direct Supabase client.

**Stage B: ledger core**
6. `accounts` table, RLS, and seeding function (plain-language chart).
7. `journal_entries` + `journal_lines`, RLS, no UPDATE/DELETE, balance trigger.
8. Invariant tests 1-5 against the empty ledger.
9. Posting function: opening balances.
10. Posting function: expense.
11. Reversal/correction function (edits become reversal + repost).

**Stage C: invoices and payments**
12. Invoice posting (A/R / Income on send; drafts post nothing); line item service date, quantity, rate; in-place line item updates.
13. `payments` + `payment_applications`; payment posting; derived invoice balance and status.
14. A/R aging view.

**Stage D: other money events**
15. Transfers.
16. Owner draws and contributions.
17. Loans, loan payments (principal/interest split), financed equipment, `fixed_assets`.
18. Credit-card accounts and card payments.

**Stage E: books drive the screens**
19. Ledger-backed P&L, Balance Sheet, A/R report.
20. Dashboard reads the ledger (new Cash Available, Money In/Out, Profit); retire the old calculations.
21. Backfill or reset test data; before/after comparison.

**Stage F: bank-feed correctness (the foundation half of Phase 2)**
22. Plaid pending-to-posted linking (`pending_transaction_id`, no hard delete of resolved rows).
23. Bank transaction resolution: match payment, match expense, transfer, loan, owner, ignore. Includes money-in review.
24. Duplicate detection (manual expense vs bank transaction).
25. Reconciliation foundation.

**Stage G: security hardening**
26. Password reset, inactivity lock, API rate limiting, Plaid token encryption.
27. Final full security re-audit and isolation re-test.

Phases 3 to 6 (Command Center, LFR migration, document workflows, Ask Your Books) stay deferred, as the brief directs.

---

## 9. Open decisions for Thomas

1. **Default reporting basis.** Accrual (income when invoiced) or cash (income when paid)? Most sole proprietors and small LLCs file cash-basis taxes, but A/R and "who owes me" need accrual-style invoice tracking. Proposal: the ledger tracks both, **cash basis is the default P&L** (matches how an owner thinks about "money in" and likely how the tax return is done), with an accrual toggle. Confirm with the tax preparer.
2. **Test data.** Wipe the current test data and start clean, or backfill it into the new ledger? Proposal: wipe and start clean.
3. **Corrections UX.** Editing a posted item will create a reversal and a new entry behind the scenes. The user just sees "edited". OK?
4. **Keep the existing expense categories** as the expense accounts (proposal: yes).
5. **Sequence.** Proposal: do Stage A (bugs and tests) first, since it is low risk and protects everything after it.

---

## 10. Carried requirements (added after Stage B review, 2026-10-22)

1. **Manual expense "Paid from" (Stages D/E, whenever the expense form is wired to the ledger).** A manual expense must end up with a real source account (bank or credit card). The UI stays simple ("Paid from"); a user-selected default account may prefill it later. No fake holding account, no guessing. Plaid-sourced expenses already know their account. Same rule for customer payments: a payment must name the real account it was deposited to.
2. **Expense-category / system-account name collision (category-management stage; must be fixed and tested before categories are touched or signups reopen).** A user category named like a system account (e.g. "Income") must never be silently skipped or routed to Uncategorized Expense. Required behavior: reject or disambiguate at category creation, plus a test that a colliding category either cannot be created or gets its own distinct expense account, and that expenses in it post to that account.
