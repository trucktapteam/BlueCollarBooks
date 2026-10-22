# Stage B report: ledger core (2026-10-22)

Nothing in the app UI, dashboard, reports or existing calculations changed. The ledger exists, is empty in production, and nothing reads or writes it yet.

## 1. Schema added
- `accounts` (chart of accounts; `(id, user_id)` unique; optional composite FK to `bank_accounts`; 10 system accounts per user, one expense account per expense category, one asset/liability account per bank account)
- `journal_entries` (date, memo, `source_type` + `source_id`, `reverses_entry_id`, creating-transaction id)
- `journal_lines` (debit_cents / credit_cents, composite FKs to entry and account on `user_id`)
- Views `account_balances`, `journal_entry_trace` (security-invoker, RLS applies)
- Functions: `seed_chart_of_accounts` (internal), `ensure_chart_of_accounts`, `post_opening_balance`, `post_expense`, `repost_expense`, `reverse_journal_entry`, `reverse_active_entry` (public API, signed-in only); `_post_entry`, `_reverse_entry`, `_active_entry`, `_post_expense`, `validate_journal_entry` (internal)
- `bank_accounts` gained `unique (id, user_id)`.

## 2. Invariants enforced by the database
1 balanced entries (deferred trigger, also checked inside the posting functions) · 2 one-sided positive lines · 3 immutable entries/lines for every role incl. service role, no TRUNCATE, no adding lines to an already-posted entry · 4 line/entry/account same owner (composite FKs) · 5 reversal must exactly negate the original, same source and date, cannot be reversed, only once · plus: at most one active entry per source (no double posting, advisory-locked), system accounts cannot be renamed/deleted, no app role has INSERT/UPDATE/DELETE on ledger tables.

## 3. Tests
`tests/sql/ledger_core.sql` (invariants 1-5, immutability, privileges, RLS, user-delete cascade) and `tests/sql/ledger_posting.sql` (seeding, opening balances, expense, edit = reversal + repost, atomic failure, reversals, invariants 8-10, traceability, cross-user and anon rejection). All pass; every run rolls back.

## 4. Mapping of BCB objects
See the Stage B message to Thomas. Expense -> `source_type='expense'`, `source_id=expenses.id`. Bank account -> `accounts.bank_account_id`. Expense category -> expense account by name.
