# Stage D Report: Other Money Events

Status: complete, stopped for review. Stage E not started. Shadow-ledger approach unchanged: no dashboard, report or existing workflow reads from or writes to the ledger yet.

## 1. What was implemented (commits 8054aa4, 1c3ed48, 2c0a37a, d18ce4d + test/report commit)
All of it is Postgres: new tables are select-only for app roles, and every write goes through a SECURITY DEFINER function scoped to `auth.uid()`, one transaction per business event.

| Step | Adds | Public functions |
|---|---|---|
| D1 transfers | shared event helpers; `transfers` | `record_transfer`, `update_transfer`, `void_transfer` |
| D2 owner | `owner_transactions`; owner-paid expenses | `record_owner_draw`, `record_owner_contribution`, `update_owner_transaction`, `void_owner_transaction` (expenses: `post_expense` / `repost_expense` accept "paid personally by owner") |
| D3 loans / equipment | `loans`, `loan_payments`, `fixed_assets`; one liability account per loan ("Loan - <name>") | `record_loan`, `update_loan`, `void_loan`, `record_loan_payment`, `update_loan_payment`, `void_loan_payment`, `record_equipment_purchase`, `update_equipment_purchase`, `record_financed_equipment`, `void_fixed_asset` |
| D4 credit cards | card payments stored as `transfers` of kind `card_payment` | `record_card_payment` (edit/void reuse the transfer functions) |

Database-enforced (commit-time, judge the CURRENT rows): every live event row has exactly one active ledger entry whose date, accounts and amounts match it; a voided row has none; live rows cannot be deleted; accounts must be the right kind (a transfer moves money out of a real bank account and into a bank account; a card payment goes to a real credit card); principal paid on a loan can never exceed the loan; a loan payment cannot predate its loan; financed equipment and its loan are live/voided together; every table keeps the `(id, user_id)` ownership pattern.

## 2. Final full-suite results (all run against the final schema)
| Suite | Result |
|---|---|
| tenant_isolation | 42/42 |
| ledger_core | 43/43 |
| ledger_posting | 38/38 (+1: commit as signed-in role) |
| invoice_save | 12/12 |
| invoice_posting | 20/20 (+1) |
| payments | 49/49 (+1) |
| ar_views | 14/14 |
| transfers (new) | 42/42 |
| owner_events (new) | 51/51 |
| loans_assets (new) | 97/97 |
| card_payments (new) | 30/30 |
| **SQL total** | **438 checks, 0 failures** |
| `npm test` | 14 tests: 10 pass, 0 fail, 4 todo (same known-bug baselines) |

Production afterwards: 0 leftover test users; accounts, journal, invoices, expenses, payments, transfers, owner, loan and equipment tables all 0; customers 4, bank accounts 4, categories 18 (unchanged). Advisors: only the intentional warnings (API functions callable by signed-in users, scoped to `auth.uid()`; `plaid_items` has no policies by design; leaked-password protection dashboard toggle). A new `search_path` warning on one helper was fixed.

Note: in the SQL runner the suites were pasted with the same logic as the committed files but a shortened final summary line (count only); the committed files print the full PASS list.

## 3. UI / workflow changes
None. No app code changed in Stage D. Nothing in the UI calls the new functions yet (shadow ledger).

## 4. How each new event posts
| Event | Debit | Credit | P&L effect |
|---|---|---|---|
| Transfer between own accounts | destination bank | source bank | none |
| Credit-card purchase (existing expense, Paid from = card) | expense account | card liability | expense, once |
| Card payment | card liability | bank | none (expense already counted) |
| Owner draw | Owner Draws | bank | none |
| Owner contribution | bank | Owner Contributions | none |
| Expense paid personally by owner | expense account | Owner Contributions | expense |
| Loan received | bank | that loan's liability account | none |
| Loan payment | loan account (principal) + Interest Expense (interest) | bank | interest only |
| Equipment bought with a bank account | Equipment | bank | none |
| Financed equipment | Equipment | new loan's liability account | none |

Every posting carries `source_type`/`source_id` back to its own row (`transfer`, `owner_draw`, `owner_contribution`, `loan`, `loan_payment`, `equipment`). Edits and voids = reversal (+ replacement); the original row is kept.

## 5. Anything unexpected
1. **Critical bug found by the new tests (fixed, migration `stage_d1_fix_ledger_triggers_run_as_definer`).** Deferred ledger triggers fire at COMMIT as the signed-in role, but they called `validate_journal_entry`, which signed-in users cannot execute (revoked in the Stage B hardening). Every real commit that posted a ledger entry would have failed with "permission denied". Earlier suites missed it because they forced the checks after switching back to the owner role. Fixed, and every suite now has a check that forces the deferred checks while still acting as the signed-in user. This would have broken Stage E, so it is good it was found before anything was wired.
2. **A payment's ledger entry could be reversed directly** with `reverse_journal_entry`, leaving the payment row out of sync (a Stage C gap). A commit-time guard now covers payments and every Stage D event.
3. **Expense "Paid from" accepted any asset or liability account**, including Accounts Receivable, Equipment and Loans Payable. Now it must be a real bank/credit-card account, or the explicit owner-paid choice. A NULL-logic slip in my first version let an expense account through; the tests caught it before it shipped.
4. Equity accounts have credit-normal balances, so Owner Draws shows as a negative equity balance. That is correct accounting and will matter for how Stage E presents it.
5. Per-loan liability accounts mean the original system account "Loans Payable" (and "Credit Cards Payable", since each card already has its own account) is unused. Stage E reports should group by account type rather than by those two names.

## 6. Decisions needed from you
1. **Owner-paid expense = owner contribution** (equity). Alternative: treat it as a loan from the owner (liability, repaid later). Which matches your preparer's approach? Reimbursing the owner later would be an owner draw.
2. **Equipment with a down payment** (part cash, part loan): not supported in one step. Today: record the cash purchase and the financed purchase as two items. Want a combined entry?
3. **Equipment paid by credit card or personally by the owner**: not supported yet (bank account or loan only). Add?
4. **Negative bank balances / overpaid cards** are allowed (not blocked); overdraft handling would belong to reconciliation (Stage F). OK?
5. **Depreciation** remains out of scope, per the plan (tax treatment is the preparer's call).

## 7. Does the Stage E-G plan still hold?
Yes, with these carried items:
- Stage E must wire the UI to the new functions, and every form that moves money needs a visible real account: Paid from, Deposited to, Transfer from/to, Draw/Contribution account, Loan deposited to, Loan payment paid from.
- Category / system-account name collision stays on the required cleanup list (plan section 10) before categories are touched or signups reopen.
- Stage G unchanged (Plaid token encryption, password reset, inactivity lock, rate limiting, leaked-password protection toggle).
- You still need to `git push` (Stage D adds only database objects and tests, so the Vercel app is unaffected).
