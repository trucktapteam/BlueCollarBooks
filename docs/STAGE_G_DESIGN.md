# Stage G design (written before implementation)

Scope: security hardening plus the three product items you approved (earlier-transactions hiding, allocate-later for unapplied payments, category-collision verification). Plaid stays in sandbox. Signups stay disabled. The workflow-function write boundary and tenant isolation do not change.

## 0. What exists today (audit of the repo)

- Browser talks to Supabase directly (anon key, RLS + workflow functions) for sign-in, password reset and all data. Our `api/` routes are only: `plaid-create-link-token`, `plaid-exchange-public-token`, `plaid-sync` (balances), `plaid-transactions-sync`, `plaid-disconnect`, `create-checkout-session`, `create-portal-session`, `stripe-webhook`.
- Authenticated routes verify the Bearer token with `supabaseAdmin.auth.getUser`. `stripe-webhook` verifies the Stripe signature with the raw body. There is no Plaid webhook route (nothing to validate there; if one is added later it must verify Plaid's JWT).
- `plaid_items.access_token` is stored in plaintext (RLS on, no policies, so only the service role reads it).
- Consequence for rate limiting: **sign-in and password-reset do not pass through our server**, so a server-side limiter cannot see them unless they are routed through it (see section 3).

## 1. Plaid token encryption

**Decision: application-level AES-256-GCM, key in the Vercel environment, only ciphertext in Supabase. Do not add Supabase Vault.**

Threat model it addresses: a database-only exposure (backup or snapshot leak, a support/engineer with SQL access, an injection or RLS mistake that reads `plaid_items`, a copied dev database). With the key outside the database, those yield useless ciphertext.

Why not Vault as well: Vault keeps its key outside the table but decrypts inside Postgres for any role that can read `vault.decrypted_secrets` (the service role). The service role key already lives in the same Vercel environment as our app key, so Vault adds no protection against the one scenario app-level encryption does not cover (Vercel environment compromise: both keys fall together) and adds SQL-side decryption paths, role grants and its own operations. One layer, kept simple.

Design:
- New module `src/server/tokenCrypto.ts` (server-only; never imported by client code, and a test asserts no client file imports it). Uses Node `crypto` AES-256-GCM, random 12-byte IV per encryption.
- Stored value: `v1.<kid>.<iv>.<ciphertext+tag>` (base64url) in a new column `access_token_enc`. Associated data = `user_id|item_id`, so a ciphertext copied to another row or user fails authentication.
- Keys: `PLAID_TOKEN_KEYS` env var = JSON `{ "k1": "<32-byte base64>" }` and `PLAID_TOKEN_ACTIVE_KEY=k1`. Decrypt looks up the key by `kid`, so old and new keys coexist during rotation.
- Rotation: add `k2`, set it active, run an admin-only script that re-encrypts rows whose `kid` is not active (idempotent, row-by-row, never logs tokens), then retire `k1`. Losing every key = users must reconnect banks (Plaid tokens are re-obtainable; no accounting data is lost). Key backup in the owner's password manager is a launch checklist item.
- All six places that read the token (`plaid-sync`, `plaid-transactions-sync`, `plaid-disconnect`, `plaid-exchange-public-token` write) go through `encryptToken` / `decryptToken`. Plaintext exists only in function memory; it is never returned to the client or logged. Plaid errors are logged without request bodies.
- Migration of existing sandbox tokens: (1) add nullable `access_token_enc`; (2) deploy code that reads `access_token_enc` if present, else the plaintext column (dual-read); (3) one-time backfill script encrypts every row; (4) verify zero rows with null `access_token_enc`; (5) migration drops the plaintext column. Because these are sandbox tokens, rolling back is also acceptable: disconnect and re-link.
- Verification: unit tests (round trip, tamper detection, wrong AAD, wrong key, rotation read of old kid), a SQL check that `access_token` no longer exists, and a script that confirms every stored value parses as `v1.` ciphertext and that no plaintext token string appears in any table.

## 2. Audit logging

- New table `audit_log(id, user_id, occurred_at, actor_id, action, entity_type, entity_id, details jsonb)`; RLS: a user can read their own rows, nobody can write except SECURITY DEFINER code and the service role; no update/delete for app roles; a trigger blocks update/delete for everyone except cascading user delete.
- Written by **after-triggers on the event and control tables** (transfers, owner_transactions, loans, loan_payments, fixed_assets, payments, refunds, expenses, invoices, bank_matches, opening balances) so every path is covered, including future ones. `actor_id = auth.uid()` (null for service-role/system, recorded as "system").
- `details` holds only ids, the action (`created`, `updated`, `voided`, `deleted`, `linked`, `unlinked`) and the names of changed fields. No free-text notes, no amounts beyond what is already an id-addressable fact in the same row, nothing from Plaid, no tokens, no passwords.
- Server-side events written by the API routes with the service role: bank connected, bank disconnected, balance/transaction sync run (counts only), checkout/portal session created, password-reset requested (user id only), rate-limit blocks.
- Tests: each mutation writes exactly one row with the right actor; no row contains a token-like value; a user cannot read another user's log or alter their own.

## 3. Rate limiting

Storage: a Postgres table `rate_limits(key, window_start, count)` and one atomic function `rate_limit_hit(key text, window_seconds int, max_hits int)` callable by the service role only. Vercel functions are stateless, so a shared store is required, and this adds no new infrastructure. Cost is one indexed upsert per limited call. Old windows are pruned opportunistically.

Where each limit is enforced and why:

| Surface | Enforced by | Proposed limit | Rationale |
|---|---|---|---|
| Sign-in (password) | Supabase Auth (it is called directly by the browser) | Keep Supabase's per-IP limits, set sign-in/sign-up burst to its minimum sensible values; add CAPTCHA (Cloudflare Turnstile) in Supabase Auth settings before signups open | Our server never sees these calls. Routing them through our API would add a custom auth path and new attack surface for little gain. |
| Failed-login lockout | Supabase Auth + our idle/session rules | Rely on Supabase's built-in throttling; no custom lockout (a lockout lets an attacker lock the owner out) | Avoids a denial-of-service lever |
| Password-reset request | New route `POST /api/request-password-reset` that rate limits then calls Supabase | 3 per email per hour, 10 per IP per hour; always returns the same "if that account exists, we sent a link" message | Stops email bombing and account enumeration. Needs custom SMTP in Supabase for deliverability and its own send limits. |
| Plaid link-token create | API, per user | 10 per hour | Only needed when connecting or repairing a bank |
| Plaid public-token exchange | API, per user | 10 per hour | Same |
| Plaid transactions sync | API, per user | 1 per 30 seconds and 40 per hour; a call inside the cooldown returns the cached result, not an error | Normal use is a button press or page load; Plaid also bills per call |
| Plaid balances refresh | API, per user | 1 per 30 seconds and 40 per hour | Same |
| Plaid disconnect | API, per user | 10 per hour | Rare, destructive |
| Stripe checkout / portal | API, per user | 10 per hour | Rare |
| Any authenticated API route | API, per IP backstop | 120 per minute | Catches loops and scripted abuse without touching ordinary use |
| Unauthenticated or invalid-token calls to API | API, per IP | 30 per minute | Slows token guessing and noisy probes |
| Stripe webhook | Not limited | none | Signature-verified and Stripe controls its own retry cadence; throttling could drop real events |
| Workflow functions (database) | Not per-call limited | none in G | They are user-scoped and bounded by atomic validation; revisit if abuse appears |

Limits are constants in one file, covered by tests (the Nth+1 call returns 429 with `Retry-After`; counters are per user and per key, not shared across users; the cooldown path serves cached data).

## 4. Authentication: password reset, leaked passwords, sessions

- **Password reset:** new `/forgot-password` and `/reset-password` screens plus the rate-limited request route above. Reset links use Supabase recovery tokens; the reset screen only accepts a recovery session, sets the new password with `updateUser`, then signs out every other session. Same neutral message whether or not the email exists.
- **Leaked-password protection:** try the Supabase Auth setting first (it is a dashboard/plan-gated toggle that I cannot flip from here; I will tell you exactly where if the plan allows it). If the plan does not include it, the reset route (and any future signup route) checks the Have I Been Pwned k-anonymity range API (only the first 5 hash characters leave the server) and enforces a 12-character minimum. Either way the advisor warning is resolved or explicitly documented.
- **Inactivity protection:** client-side idle timer. After 30 minutes without input the app shows a "still there?" lock for 2 minutes; if ignored, the session is signed out and cached financial data is cleared from memory. Activity is shared across tabs. Background tabs count as idle. Absolute session cap of 12 hours before a fresh sign-in is required. A Supabase server-side inactivity timeout is applied too if the plan supports it. Typing in a form counts as activity, so long invoices are not interrupted. Constants are in one file.
- Server auth unchanged: every API route keeps `getUserFromAuthHeader`; tests assert each route returns 401 without a valid token and the Stripe webhook returns 400 without a valid signature.

## 5. Earlier transactions (decision 1)

`bank_feed` gets an `before_start` flag (transaction date on or before the account's starting-balance date; accounts with no starting balance have none). To review excludes them and the review count ignores them. A new "Earlier" tab lists them read-only with "Put in review anyway" so nothing is lost or inaccessible. Reconciliation is already unaffected.

## 6. Allocate an unapplied customer payment (decision 2)

New function `apply_payment_to_invoices(payment_id, applications jsonb)`: you pick invoices and amounts; it validates ownership, same customer, posted (not draft/void) invoices, each amount at most the invoice's current balance, total at most the payment's unapplied amount, then inserts the applications. It never touches the ledger (applications are sub-ledger only, so A/R and cash do not change). Remainder stays unapplied. A small "Allocate" dialog opens from the payments list and from the bank-feed row for a matched payment. Tests: over-apply, wrong customer, draft invoice, other tenant, repeated call, remainder stays, A/R reconciliation unchanged.

## 7. Category / system-account name collision (carried since Stage B)

Already implemented in Stage E1 (a category named like a system, bank or loan account is rejected at create, rename and save; the `stage_e_workflows` suite has 8 collision checks plus the new-category-posts-to-its-own-account check). Stage G re-verifies it in the final run and adds a check that renaming a bank account to a category name is also refused. No schema redesign.

## 8. Plaid reconnect and history continuity (decision 7)

Facts: Plaid's `account_id` is per item, so removing a bank and linking it again produces new ids, and today that would create a second `bank_accounts` row with no relation to the first.

Design, implemented in G because it is a launch blocker you named:
- **Do not disconnect to fix a broken login.** A `needs_reauth` item is repaired with Plaid Link **update mode** using the same `item_id` (account ids and history stay). The reconnect button uses this path.
- **Genuine re-link (after a disconnect, or a new item for the same bank):** on exchange, the server compares each returned account to the user's existing bank accounts by institution, account type/subtype, last four digits and name, and (when Plaid supplies it) `persistent_account_id`. Candidates are returned to the user with "Is this your existing Checking ending 1234?"
- **Confirmed match:** a database function `relink_bank_account(bank_account_id, new_plaid_item, new_plaid_account_id)` re-points the existing `bank_accounts` row (same `id`, same ledger account, same starting balance, same history) at the new Plaid account. Old feed rows stay, marked as from the earlier connection.
- **Overlap safety:** the first sync after a re-link will return recent history the books already contain. New rows that exactly match an already-recorded transaction (same account, date, amount) are surfaced as matches-first candidates through the existing BC001 flow rather than recorded again. Anything ambiguous stays in review; nothing is auto-posted.
- **Declined match:** the new account is created as a separate account, and the UI says plainly that it starts with its own starting balance.
- Tests cover re-point, no second ledger account, no cross-user relink, no relink onto an account that has a live Plaid link, and overlap candidates.
- Production Plaid stays out of scope; this must be verified again against the real bank before launch (sandbox does not reproduce `persistent_account_id`).

## 9. Test plan for the end of Stage G

All SQL suites (existing 18 plus new: `audit_log`, `rate_limits`, `earlier_transactions`, `payment_allocation`, `relink_bank_account`, extended `security_privileges`), Node tests (token crypto, rate limiter, route auth, no client import of server crypto, idle timer logic), the Supabase security and performance advisors, and a grep proving no plaintext token column or log line remains. Every suite is re-run after the last migration.

## 10. Order of work and commit boundaries

G1 audit log. G2 rate limiter and API wiring. G3 token encryption (dual-read, backfill, drop plaintext). G4 password reset, leaked-password handling, idle/session protection. G5 earlier-transactions tab and allocate-payment function and dialog. G6 reconnect continuity. G7 final full test run, advisor review, `STAGE_G_REPORT.md`, stop.
