# Stage E report: the app now runs on the books

Status: complete, stopped before Stage F. Commits: `8e27b04` (E1 DB), `4cb3625` (E1b tests), `2d20a4d` (E2), `1ace2d0` (E3), `049c892` (E4), `1f115ee` (E5), plus the final test/doc commit. Nothing is pushed; you run `git push`.

## 1. Test results (final schema, nothing changed since the E1b migration)

All SQL suites were pasted into the live database and always roll back. Every one ended `ALL PASS`.

| Suite | Checks |
|---|---|
| tenant_isolation | 39 |
| ledger_core | 43 |
| ledger_posting | 39 |
| invoice_save | 12 |
| invoice_posting | 21 |
| payments | 49 |
| ar_views | 14 |
| transfers | 42 |
| card_payments | 30 |
| owner_events | 51 |
| loans_assets | 98 |
| equipment_funding | 84 |
| stage_e_workflows | 109 |
| **SQL total** | **631 pass, 0 fail** |

Node: `npm test` = 11 tests, 9 pass, 0 fail, 2 todo. The 2 todo are the Plaid pending-transaction baselines, which belong to Stage F. The two dashboard baselines (money in, cash available) were deleted because the formulas they pinned no longer exist; `stage_e_workflows` now tests the replacement (`dashboard_summary`, cash vs accrual P&L, balance sheet, as-of dates).

Older suites needed these edits (test code only, no schema change): `save_invoice` now posts, app roles can no longer write expenses/invoices directly, and some rules are deferred checks that must be forced with `set constraints all immediate` inside the exception block.

Not verifiable here: ESLint, Metro, and `expo export` do not run in my sandbox, and I cannot click through the UI. `tsc` is clean apart from the known `/transactions` typed-route errors (dashboard x2, expenses x1). **Please run the app once and click through the flows in section 2 before relying on any of it.**

## 2. User-facing workflows changed

- **Add / edit Money Out (new-expense):** new required "Paid from" (every connected bank account and card, plus "I paid personally"). The last choice is offered again as a changeable default, never guessed. Saving is one database step: expense row + books entry, or nothing. Errors show on screen instead of failing silently. Editing keeps the original account unless you change it; changing it moves the money.
- **Categorize a bank transaction:** now an expense paid from that transaction's own connected account (checking, or the card for card transactions). Atomic; the transaction links both ways. Money-in rows are rejected (Stage F).
- **Invoices:** saving a Sent invoice posts it in the same step; Draft posts nothing; moving between Draft and Sent posts/unposts. Only Draft/Sent are stored. Paid, Due Today and Overdue are derived from payments applied and the due date.
- **Record Payment (invoices page and customer page):** new required "Deposited to" (bank accounts only). Recorded through `record_payment`; the old customer-page "Mark Paid" button, which flipped a status with no account, is now "Record Payment" and opens the same dialog. Paid amounts come from payment applications.
- **Dashboard:** Cash Available, Money In, Money Out, Profit, Waiting To Be Paid and a new Overdue card all come from the books (`dashboard_summary`). "Paid This Month" is gone (it is now identical to Money In, which is cash collected). A "Set your starting balances" card appears until each account has one. The Bank Accounts total is relabeled "Bank-reported total".
- **Reports:** Money In / Money Out By Type / Profit now come from the ledger with a "when it comes in" (cash, default) vs "when I bill it" (accrual) toggle. New sections: what you have and owe (balance sheet) and who owes you (A/R aging). Payments received but not yet matched to an invoice show on their own row. CSV: the Money CSV uses the ledger figures; expenses/invoices/payments CSVs are unchanged lists.
- **Expenses page:** this-month total comes from the books.
- **Customers page:** "Money Made" is now payments received (was the sum of every invoice, drafts included).
- **New "Move Money" screen** (sidebar): move between my accounts, pay a credit card, I put my own money in, I took money out, I received a loan, I made a loan payment (principal + interest), I bought equipment (one or more funding sources: bank, card, "I paid personally", financing). Nothing here is reachable only through SQL any more.

## 3. How old / shadow behavior was retired

- `invoice_payments` table and `receiveInvoicePayment`'s insert: dropped; payments live in `payments` + `payment_applications`.
- `dashboardMetrics.ts`, `calculateInvoiceTotal`, `calculatePaidInvoiceTotal`, `calculateWaitingToBePaidTotal`, `calculateTotalMonthlyExpenses`: deleted. `calculateInvoiceBalance` now only sums applied payments (the "status Paid means fully paid" fallback is gone).
- Cash Available = ledger balances of bank accounts, no longer bank balance + paid this month - expenses.
- Direct client writes: app roles have no INSERT/UPDATE/DELETE/TRUNCATE on expenses or invoices (and TRUNCATE/REFERENCES/TRIGGER were revoked broadly). `saveExpense`'s upsert and `updateInvoiceStatus`'s update are replaced by RPCs.
- Generic `Loans Payable` / `Credit Cards Payable` accounts removed (D5). The category/system-account name collision is blocked by a trigger and tested.
- Prod has 0 invoices, 0 expenses, 0 journal entries, so there was nothing to backfill; the before/after comparison is trivially empty. The 4 test bank accounts get books accounts on first sign-in (`ensure_books`).

## 4. Compatibility issues and loose ends

1. Typed-route file is stale: the new `/move-money` and existing `/transactions` routes show as `tsc` errors until Expo regenerates route types (`npx expo start`). I fixed the stale `/dashboard` one.
2. Plaid money-in deposits and transfers/card-payment rows are not posted until Stage F, so ledger cash will not match bank cash until the resolve flow exists. Cash Available is only accurate once starting balances are entered and, after that, all activity is recorded here.
3. `plaid_transactions` is still directly writable by the signed-in user (exclude/restore and `category`/`expense_id`). It cannot corrupt the ledger, but a user could link a transaction to the wrong expense. Needs an RPC in Stage F.
4. Supabase advisor: 35 `SECURITY DEFINER` functions are callable by signed-in users. The public workflow ones are intended and user-scoped. Lower-level ones are also exposed (`post_expense`, `repost_expense`, `post_opening_balance`, `reverse_journal_entry`, `reverse_active_entry`, `sync_invoice_posting`, `ensure_chart_of_accounts`). They are scoped to the caller and the commit-time checks still apply, but the app does not need them. Revoking them means moving about eight test suites to the privileged role; I left it for Stage G hardening. Also still open: leaked-password protection (Stage G).
5. There is no UI to delete an expense/invoice, or to edit/void a transfer, owner transaction, loan, payment or equipment. The database functions exist and are tested. Mistakes in Move Money currently cannot be undone from the screen.
6. Deleting an expense (when that UI exists) removes receipt rows by cascade but leaves the uploaded files in storage.
7. Derived invoice status in the browser uses the device clock; dashboard/report numbers use local dates the client sends. Both agree unless the device clock is wrong.
8. Duplicate / pending Plaid ids remain the known baseline bug (2 todo tests).
9. DB errors reach the user as the database message. Plain-language error text is a polish item.

## 5. Decisions needed before reconciliation / report cutover (Stage F)

1. **Starting balances:** the user must type each account's starting balance and date. Should the app force this before showing Cash Available (blocking card) or keep the current soft prompt?
2. **Plaid money-in:** a deposit could be a customer payment, an owner contribution, a loan, a transfer, or a refund. The resolve flow must ask. Which choices should we offer, and should "customer payment" require picking invoices?
3. **Transfers between connected accounts:** auto-detect matching outflow/inflow pairs and propose a transfer, or always ask?
4. **Pending vs posted transactions:** keep the current baseline behavior until the resolve flow, or fix pending replacement first?
5. **Unapplied payments:** payments received but not matched to an invoice show in the cash P&L on their own row. Confirm that is how you want customer credits presented.
6. **Stored vs derived invoice status:** confirm that only Draft/Sent are stored and Paid/Overdue are always derived.
7. **Move Money scope:** add edit/undo for each event now, or only as part of Stage F's review screens?
8. **Security hardening:** revoke the low-level functions in item 4 of section 4 before sign-ups open?
