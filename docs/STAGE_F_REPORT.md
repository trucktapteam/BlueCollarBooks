# Stage F report: bank feed, matching, reconciliation, corrections, lockdown

Status: complete, stopped before Stage G. Commits (nothing pushed; you run `git push`): `e8846b0` (F1), `714f631` (F2 DB), `4c42f69` (F2 app), `e6aebdb` (F3), `45840fe` (F4), `ee1d40e` (F5), plus the final test/doc commit.

## 1. Test results (final files, final schema)

Every SQL suite was run end to end from the committed files against the live database after the last migration. Each runs in one transaction that always rolls back, and each ended `ALL PASS`. Nothing is carried over from earlier pre-edit runs.

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
| plaid_feed (F1) | 40 |
| bank_review (F2) | 97 |
| reconciliation (F3) | 16 |
| money_activity (F4) | 11 |
| security_privileges (F5, allowlist) | 19 groups |
| **SQL total** | **795 checks + 19 privilege groups, 0 fail** |

Node: `npm test` = 13 pass, 0 fail (the two Plaid pending-transaction baselines from Stage E are now real tests). `tsc` shows only the known typed-route errors (`/transactions` x3 in dashboard/expenses, `/move-money` in AppShell).

Things the re-run caught: two stale lines in `bank_review.sql` left from an F2 edit (a "different amount" pair check that actually used equal amounts, and a step that re-matched an already linked transaction). Both were test bugs, fixed, and the suite passes at 97. No database behavior was wrong.

Not verifiable here: ESLint, Metro, `expo export` and the UI do not run in my sandbox. **Please click through sections 2 to 7 in the app before relying on them.**

## 2. Bank review workflow

- `/transactions` has tabs: To review, Pending, Recorded, Ignored. Each row comes from the `bank_feed` view (states: needs review, pending, recorded, ignored, "not sure").
- The account is never asked: a Plaid transaction already knows its connected account (checking or card).
- Money out can be recorded as: expense, owner draw, loan payment (principal + interest), transfer to another account, or match to something you already entered.
- Money in can be recorded as: customer payment, owner put money in, loan received, transfer from another account, refund/money back, or Other/Not sure.
- "Not sure" keeps the transaction open with a note. Nothing is guessed and nothing posts.
- Everything is one atomic database call (`resolve_bank_transaction`, `match_bank_transaction`, `confirm_transfer_pair`, `undo_bank_resolution`). Undo unlinks; if the bank row created the event, undo voids it (a transfer pair goes together).
- Links live in `bank_matches` (one nullable target column per kind, composite `(id, user_id)` foreign keys, one live link per bank transaction and per event side). Plaid rows can no longer be linked or edited directly.

## 3. Pending to posted

- `apply_plaid_sync_page` (service role only) writes a page atomically: adds, modifies and removals together or not at all.
- A posted row carrying `pending_transaction_id` supersedes the pending row. The pending row stays as history (`status = superseded`, `superseded_by`), so there is exactly one active row for the real-world transaction.
- Ignored, "not sure" and note decisions move to the posted row. A valid recorded link moves too. If the final amount or account differs, the link is released with a note and what you recorded stays in the books for you to fix.
- A bank removal marks the row removed (never deleted) and releases its link. A late posted row after a removal still takes over the pending row's state. A removed row the bank re-sends becomes active again; a superseded row never resurrects.
- Pending transactions cannot be recorded (they can be marked "not sure" or ignored).

## 4. Deposit matching

- Matching existing events comes first. `bank_match_candidates` suggests the same account, same amount, direction-correct, within 14 days. Customer payments already recorded are offered first for money in.
- If a plausible existing match is there and you try to record something new, the database refuses with `BC001` unless you explicitly confirm "this is a different one" (`confirm_new`). Detectable transfer sides are protected the same way.
- A deposit that matches an existing customer payment is never recorded as new income, and a transfer is never recorded as income or expense (both tested).
- Customer payments created from the review screen only allocate to the invoices you explicitly select, up to their balances; the rest stays unapplied. Matching to an existing payment keeps its applications. Allocation is never inferred from amount, customer or open balances.

## 5. Transfer matching

- `bank_transfer_proposals` pairs one outflow and one inflow of the same amount within 4 days between your own accounts. A bank-to-bank pair is a transfer; bank to card is a card payment (the card owes less).
- If two partners are equally plausible the proposal is flagged ambiguous and you pick; the other row stays open.
- You confirm each pair (`confirm_transfer_pair`): one transfer, both bank rows linked, no income or expense touched.
- Transfers to or from an account with no bank feed (manual account) work from either side.

## 6. Reconciliation

- `reconciliation_accounts` and `reconciliation_unlinked_items` (views, read-only) cover connected bank accounts and cards after their starting-balance date.
- Per account: books balance, bank-reported balance, difference, then the pieces that explain it: bank transactions not yet recorded, bank transactions you ignored, and recorded items with no bank transaction. Whatever is left is shown as **unexplained**. Status: agrees, explained by open items, unexplained, or needs a starting balance.
- It never posts, adjusts or plugs anything; a test proves the journal is unchanged after reading. Working the list down changes what explains the difference, not the difference.
- Pending and before-starting-date transactions are shown but kept out of the equation. Cards use the amount-owed sign convention. A/R is reconciled separately by `ar_reconciliation_as_of`.
- The dashboard does not show Cash Available as a dollar figure while any account is missing its starting balance.

## 7. Corrections and voids

- Move Money has a "recent activity" list (`money_activity`: transfers, card payments, owner draws/contributions, loans, loan payments, refunds, equipment, customer payments) with Edit and Void where allowed. Underneath it is always reversal plus repost; you see "edited" or "voided".
- Loans, equipment and customer payments are void-only from this list (their edit rules are stricter).
- Editing the amount or account of something linked to the bank is refused with a clear reason until the link is removed; editing only the date, note or category keeps the link. Voiding a linked item releases the link and the bank row returns to review.
- Expenses have a two-tap Delete that reverses the books and returns the bank row to review.

## 8. Security changes

- The seven low-level functions are revoked from `public`, `anon` and `authenticated`: `post_expense`, `repost_expense`, `post_opening_balance`, `reverse_journal_entry`, `reverse_active_entry`, `sync_invoice_posting`, `ensure_chart_of_accounts`. Signed-in users reach the ledger only through the workflow functions, which validate accounts, sources and bank links.
- `plaid_transactions` and `bank_accounts` are no longer writable by app roles (insert/update/delete/truncate all refused); the only writer is the service-role sync function. The old `expense_id` and `category` columns and `categorize_plaid_transaction` are gone.
- New `security_privileges` suite is an allowlist: the seven are not executable by authenticated or anon, the workflow functions are authenticated-only, no underscore helper or trigger function is exposed, nothing in `public` is executable by anon, and the sync function is server-only. The older suites now call the revoked functions through test-only `pg_temp` wrappers.
- Supabase advisor (security) after F5: 38 WARNs "signed-in users can execute SECURITY DEFINER function" (all are the intended workflow API, each scoped to `auth.uid()` and pinned to `search_path = public, pg_temp`), 1 INFO (`plaid_items` has RLS and no policies, deliberate: tokens are server-only), 1 WARN leaked-password protection off (Stage G).

## 9. Remaining accounting and data-integrity gaps

- Excluded (ignored) bank transactions leave a reconciliation difference by design; they show in the explained part.
- Transactions dated before an account's starting balance still appear in To review (reconciliation ignores them). Possible auto-hide.
- Bank-bought equipment has no bank-feed option; use Move Money, then match.
- Imported expenses cannot have their amount or account edited without unlinking first.
- Match validation is account + amount + direction; the 14-day window is a suggestion only, not a hard rule.
- Customer-payment allocation: unapplied payments stay in A/R until you allocate them (intended); there is no UI yet to allocate later from the bank feed.
- Plaid access tokens are stored unencrypted in `plaid_items` (server-only table, Stage G).
- Disconnecting a bank item and re-linking the same real account creates a new `plaid_account_id`; the books' account link is not merged automatically.
- Multi-currency, sales tax, 1099/payroll and depreciation are out of scope.

## 10. Decisions needed before Stage G and launch hardening

1. Auto-hide bank transactions dated before the starting balance, or keep showing them?
2. Allow a later "allocate this unapplied payment to invoices" screen before launch, or after?
3. Should signups stay disabled until Stage G finishes (password reset, inactivity lock, rate limiting, Plaid token encryption, leaked-password protection), or open to a small invited group earlier?
4. Plaid token encryption approach: Supabase Vault, an application-level key in Vercel env, or both?
5. Rate-limit target and place: Vercel edge/middleware, Supabase, or both; and the limits for sign-in, password reset and sync.
6. Keep the 38 SECURITY DEFINER workflow functions as the only write path (current design), or add a request-level audit log of every call before launch?
7. Production Plaid: when to move off sandbox, and whether reconnect/unlink must merge account history.
