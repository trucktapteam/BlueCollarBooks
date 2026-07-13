# BlueCollarBooks Code Audit

Read-only diagnostic pass. No code was modified. All findings reference the current state of `main` as of 2026-07-13.

Severity key: **Critical** = wrong numbers/data loss a user could act on · **High** = broken/misleading behavior in normal use · **Medium** = fragile but not yet broken · **Low** = cosmetic/cleanup

---

## 1. MONEY HANDLING

### Type inventory (where money lives and how it's typed)

| Field | Type | File |
|---|---|---|
| `Invoice.amount` | **string** (formatted, e.g. `"$625"`) | [src/data/mockInvoices.ts:10](src/data/mockInvoices.ts#L10) |
| `InvoiceLineItem.amount` | **string** (e.g. `"$625"`) | [src/data/mockInvoices.ts:26](src/data/mockInvoices.ts#L26) |
| `InvoicePayment.amount` | **number** | [src/data/mockInvoices.ts:31](src/data/mockInvoices.ts#L31) |
| `Expense.amount` | **number** | [src/data/mockExpenses.ts:10](src/data/mockExpenses.ts#L10) |
| `BankAccount.balance` | **number** | [src/data/mockBankAccounts.ts:8](src/data/mockBankAccounts.ts#L8) |

All numbers are floating-point dollars — nothing in the codebase stores money as integer cents.

**High — [src/data/mockInvoices.ts:10](src/data/mockInvoices.ts#L10), :26** — Invoice and line-item amounts are the *only* money values stored as display-formatted strings (`"$625"`, with `$` and thousands separators baked in) rather than numbers. Every consumer must remember to call `parseInvoiceAmount()` before doing arithmetic. This is the one genuinely inconsistent representation in the app: same concept (a dollar amount), two different storage shapes depending on which record type it's attached to (Invoice/LineItem = string vs. Payment/Expense/BankAccount = number).

**Direct arithmetic on formatted strings: not found.** I checked every call site of `invoice.amount` and `item.amount` (line items) — [src/data/mockInvoices.ts:215,218,222,408,430](src/data/mockInvoices.ts#L215), [src/app/new-invoice.tsx:77,612](src/app/new-invoice.tsx#L77), [src/components/ReceivePaymentModal.tsx:16](src/components/ReceivePaymentModal.tsx#L16), [src/app/new-expense.tsx:10](src/app/new-expense.tsx#L10) — and all of them route through `parseInvoiceAmount()` / an equivalent local regex-strip-then-`Number()` helper before doing math. No `+`/`-` is ever applied directly to a `"$…"` string.

**Medium — money formatting is inconsistent across the app.** Most screens use `formatInvoiceAmount()` (Intl currency formatter, [src/data/mockInvoices.ts:193-200](src/data/mockInvoices.ts#L193-L200)), but several places manually build a string instead:
- [src/app/index.tsx:49](src/app/index.tsx#L49) — `` `$${moneyOut.toLocaleString()}` `` for "Money Out"
- [src/app/expenses.tsx:101](src/app/expenses.tsx#L101) — `` `$${totalMonthlyExpenses.toLocaleString()}` `` for "Money Out This Month"
- [src/app/expenses.tsx:143](src/app/expenses.tsx#L143) and [src/app/index.tsx:437](src/app/index.tsx#L437) — raw `` `$${expense.amount}` `` per-row (no thousands separator, no fixed decimals — `$1234.5` would render un-grouped and with one decimal digit instead of two)
- [src/app/index.tsx:404](src/app/index.tsx#L404) — `` `$${totalOverdueAmount.toLocaleString()}` ``

These three formatting styles (`formatInvoiceAmount`, `toLocaleString()` with a manual `$`, and raw template interpolation) can render the same underlying number differently (e.g. `$1,234` vs `$1234.5` vs `$1,234.00`) depending on which screen you're on. 43 occurrences of `.toLocaleString()`/`formatInvoiceAmount` total across 9 files — worth consolidating on one formatter.

**Low — [src/app/reports.tsx:104](src/app/reports.tsx#L104)** — `exportInvoicesCsv()` writes `invoice.amount` (the raw `"$625"` string) into a CSV column, while `exportExpensesCsv()` and `exportPaymentsCsv()` write plain numbers for the same conceptual column. A downstream spreadsheet import would see a text column next to numeric columns.

---

## 2. IDENTITY / STABLE IDS

| Record type | Keyed by | Stable? |
|---|---|---|
| Customer | `name` (string) | **No** |
| Invoice | `invoice` (invoice number string) | **No** |
| Invoice line item | array index (no id field at all) | **No** |
| Expense | `id` (generated, e.g. `k2j3h4-abc12345`) | Yes |
| Expense receipt / Invoice attachment | `id` (generated) | Yes |
| Invoice payment | `id` (generated) | Yes |
| Bank account | `id` (static string) | Yes |

**Critical — Customer is looked up and matched by `name` everywhere, not a permanent ID.** `Customer` ([src/data/mockCustomers.ts:5-12](src/data/mockCustomers.ts#L5-L12)) has no `id` field at all.
- `saveCustomer()` matches the record to update via `item.name === lookupName` — [src/data/mockCustomers.ts:51](src/data/mockCustomers.ts#L51)
- Every invoice stores the customer as a free-text `customer: string` (the name) — [src/data/mockInvoices.ts:9](src/data/mockInvoices.ts#L9)
- Customer↔invoice association is done by string equality: `invoices.filter((invoice) => invoice.customer === customer.name)` — [src/app/customers.tsx:42](src/app/customers.tsx#L42)
- Same pattern for the customer-picker dropdown: [src/app/new-invoice.tsx:98,128](src/app/new-invoice.tsx#L98), [src/app/new-customer.tsx:33](src/app/new-customer.tsx#L33)
- React list key is also the name: `key={customer.name}` — [src/app/customers.tsx:134](src/app/customers.tsx#L134)

**Consequence — renaming a customer silently orphans their invoice history.** [src/app/new-customer.tsx:46-58](src/app/new-customer.tsx#L46-L58) calls `saveCustomer({ name: companyName, ... }, originalName)`. This renames the customer record in place but **never touches `invoice.customer` on any existing invoice**. After a rename, `customers.tsx:42`'s `invoice.customer === customer.name` check stops matching, and every past invoice for that customer disappears from their customer-detail view (revenue, waiting-to-be-paid, invoice count, last-bill date all reset to zero/empty) even though the invoices still exist and still show the old name on the Invoices screen. There is no cascade-rename anywhere in the codebase (confirmed by searching for any code that rewrites `invoice.customer` on a customer save — none exists).

**Consequence — nothing prevents two customers sharing a name.** `saveCustomer()` only overwrites an existing record if the name matches exactly; creating a second customer with an identical name just appends a second record ([src/data/mockCustomers.ts:58-61](src/data/mockCustomers.ts#L58-L61)), and every downstream lookup (`.find(item => item.name === x)`) will silently and deterministically resolve to whichever one comes first, hiding the other.

**High — Invoice number doubles as both a display field and the relational/primary key**, and it is user-editable. `Invoice.invoice` ([src/data/mockInvoices.ts:8](src/data/mockInvoices.ts#L8)) is:
- The lookup key for saves/updates: `invoicesSnapshot.findIndex(item => item.invoice === lookupInvoiceNumber)` — [src/data/mockInvoices.ts:227](src/data/mockInvoices.ts#L227)
- The key used for attachments, status updates, and payments — [src/data/mockInvoices.ts:252,284,320,344,366](src/data/mockInvoices.ts#L252)
- The React list key on the Invoices screen and in `ReceivePaymentModal`
- **A free-text, directly-editable field in the invoice form**: `<Field label="Invoice #" value={number} onChangeText={setNumber} />` — [src/app/new-invoice.tsx:384](src/app/new-invoice.tsx#L384)

Because the number is both the editable display label and the storage key, typing an existing invoice number into a *different* invoice's "Invoice #" field and saving will silently overwrite that other invoice (the `findIndex` match on save resolves to the first invoice with that number). `getNextInvoiceNumber()` ([src/app/new-invoice.tsx:35-42](src/app/new-invoice.tsx#L35-L42)) only guards against collisions for auto-assigned numbers on the *new*-invoice flow; it does nothing to stop a manual edit from colliding with an existing number.

**Medium — invoice line items have no identifier at all.** `InvoiceLineItem` ([src/data/mockInvoices.ts:24-27](src/data/mockInvoices.ts#L24-L27)) is just `{ description, amount }`. Add/update/remove all operate on array index — [src/app/new-invoice.tsx:82,86,90](src/app/new-invoice.tsx#L82-L90). Fine for a single-session form, but there's no way to track/diff a specific line item across saves, and reordering would silently reassign which row's data maps to which index.

**Low — React list keys built from mutable data + index rather than the stable id that already exists.**
- [src/app/expenses.tsx:134](src/app/expenses.tsx#L134): `key={`${expense.date}-${expense.vendor}-${index}`}` — `Expense.id` exists ([src/data/mockExpenses.ts:6](src/data/mockExpenses.ts#L6)) and is not used here.
- [src/app/index.tsx:428](src/app/index.tsx#L428): same pattern, `key={`${item.date}-${item.vendor}-${index}`}`.
- [src/app/index.tsx:409](src/app/index.tsx#L409): `key={`${item.invoice}-${index}`}` — redundant index since invoice numbers are already unique in practice, but reflects the same "didn't reach for the id" pattern.

---

## 3. DATE HANDLING

Dates are stored as **plain strings in at least three different formats**, chosen inconsistently by call site, with no shared parser:

- `"Apr 1, 2026"` (long month name) — seed data, e.g. [src/data/mockInvoices.ts:89](src/data/mockInvoices.ts#L89)
- `"06/09/2026"` (MM/DD/YYYY) — form drafts, e.g. [src/data/mockInvoices.ts:70](src/data/mockInvoices.ts#L70), [src/data/mockExpenses.ts:44](src/data/mockExpenses.ts#L44)
- `"2026-06-09"` (ISO, `YYYY-MM-DD`) — payment dates from `ReceivePaymentModal`: `date.toISOString().slice(0, 10)` — [src/components/ReceivePaymentModal.tsx:12](src/components/ReceivePaymentModal.tsx#L12)
- Free-text: `Invoice Date` and `Date Paid` are plain `TextInput`s with no picker and no format validation — [src/app/new-invoice.tsx:385](src/app/new-invoice.tsx#L385), [src/components/ReceivePaymentModal.tsx:125-131](src/components/ReceivePaymentModal.tsx#L125-L131) — so a user can type anything, including a string that fails to parse.

Date parsing is **reimplemented separately at least four times** with slightly different fallback logic, instead of sharing one function:
- [src/data/mockInvoices.ts:139-150](src/data/mockInvoices.ts#L139-L150) `parseDateStringToDate` (tries `Date.parse`, then manually splits on `/`)
- [src/app/index.tsx:67-75](src/app/index.tsx#L67-L75) — near-identical local copy inside `HomeScreen`
- [src/app/invoices.tsx:93-103](src/app/invoices.tsx#L93-L103) `buildInvoiceDueDate` — only tries `Date.parse`, no `/`-split fallback
- [src/app/reports.tsx:55-66](src/app/reports.tsx#L55-L66) `buildInvoiceDueDate` — another near-duplicate, only `Date.parse`

A date string that fails `Date.parse` but isn't `M/D/Y` (e.g. a typo) silently falls through to "no due date" in some of these copies and is treated differently (e.g. dumped into the "current" aging bucket, [src/app/index.tsx:96-98](src/app/index.tsx#L96-L98)) depending on which of the four copies happened to run.

### Reports / P&L date filtering — **not implemented despite the label**

**Critical — [src/app/reports.tsx:68-75](src/app/reports.tsx#L68-L75).** The Reports screen header says "📈 This Year" and shows the current year number ([src/app/reports.tsx:149-151](src/app/reports.tsx#L149-L151)), but the figures underneath are **not filtered by year at all**:
- `income = calculateInvoiceTotal(invoices)` — sums every invoice ever created, all-time. `calculateInvoiceTotal` ([src/data/mockInvoices.ts:407-409](src/data/mockInvoices.ts#L407-L409)) takes no date parameter and applies no filter.
- `totalExpenses = calculateTotalMonthlyExpenses(expenses)` — despite the function's name, it also sums every expense ever recorded with no date filter at all ([src/data/mockExpenses.ts:196-198](src/data/mockExpenses.ts#L196-L198)).
- `netProfit = income - totalExpenses` inherits the same lack of filtering.

The function `calculatePaidInvoiceTotal()` ([src/data/mockInvoices.ts:419-435](src/data/mockInvoices.ts#L419-L435)) *does* correctly filter payments to the current month (via `isSameMonth`) — but it is **never called from reports.tsx**. It's only used on the Dashboard ([src/app/index.tsx:47](src/app/index.tsx#L47)), meaning the one place in the codebase with correct month-filtering logic isn't the one labeled "This Year."

**Critical — [src/app/index.tsx:24-25,49](src/app/index.tsx#L24-L25), [src/app/expenses.tsx:100-101](src/app/expenses.tsx#L100-L101).** Same bug on the Dashboard and Expenses screen: labels read "Money In — This month" / "Money Out — This month" / "Money Out This Month," but:
- `moneyIn = calculateInvoiceTotal(invoices)` — all-time, no month filter — [src/app/index.tsx:44](src/app/index.tsx#L44)
- `moneyOut = calculateTotalMonthlyExpenses(expenses)` — also all-time, despite the name — [src/app/index.tsx:45](src/app/index.tsx#L45), [src/app/expenses.tsx:67](src/app/expenses.tsx#L67)

So every "this month" figure the app shows the user is actually a lifetime total. Only two figures in the whole app are genuinely period-filtered: `paidThisMonth` (Dashboard, via `calculatePaidInvoiceTotal`) and `paymentsThisMonth` (Payments screen, via a correctly-written local `isSameMonth` — [src/app/payments.tsx:8-13,67-70](src/app/payments.tsx#L8-L13)).

---

## 4. PERSISTENCE LAYER

**All persistence goes through `window.localStorage`**, wrapped by two functions in [src/data/persistentStore.ts](src/data/persistentStore.ts) (`loadPersistedData` / `persistData`), guarded by a `typeof window.localStorage !== 'undefined'` check so it no-ops (returns fallback, silently skips writes) on native/SSR. Confirmed no other storage backend (no SQLite, AsyncStorage, IndexedDB, or remote API) exists anywhere in `src/`.

Storage keys in use, one per store, each its own independent localStorage entry (no shared transaction — a crash between two `persistData` calls can leave stores out of sync with each other):
- `bluecollarbooks_invoices` — [src/data/mockInvoices.ts:107](src/data/mockInvoices.ts#L107)
- `bluecollarbooks_customers` — [src/data/mockCustomers.ts:41](src/data/mockCustomers.ts#L41)
- `bluecollarbooks_expenses` — [src/data/mockExpenses.ts:62](src/data/mockExpenses.ts#L62)
- `bluecollarbooks_activity` — [src/data/activityStore.ts:10](src/data/activityStore.ts#L10)
- `bluecollarbooks_bank_accounts` — [src/data/mockBankAccounts.ts:29](src/data/mockBankAccounts.ts#L29)
- `bluecollarbooks_business` — [src/data/mockBusiness.ts:23](src/data/mockBusiness.ts#L23)

**Medium — write failures are swallowed silently.** `persistData()` wraps `localStorage.setItem` in a try/catch that just comments `// Ignore storage failures` — [src/data/persistentStore.ts:25-29](src/data/persistentStore.ts#L25-L29). If the browser is in private mode, storage is full, or the quota is exceeded, the save call returns normally and the UI shows a "Saved" toast even though nothing was persisted — the user has no way to know their data didn't survive a refresh.

**Backup/export mechanism: partial, no full backup exists.** There is a per-category CSV export on the Reports screen (`exportProfitAndLossCsv`, `exportExpensesCsv`, `exportInvoicesCsv`, `exportPaymentsCsv` — [src/app/reports.tsx:78-122](src/app/reports.tsx#L78-L122)), each downloading a separate `.csv` via a Blob/`<a download>` trick ([src/app/reports.tsx:39-53](src/app/reports.tsx#L39-L53)). **Confirmed: there is no whole-database export/import** — no `JSON.stringify` of the full localStorage state anywhere, no "Export all data" / "Backup" button, and no restore/import path at all. If localStorage is cleared (or the user switches browsers/devices), all customers, invoices, expenses, payments, and settings are unrecoverable — the CSVs are a one-way, partial, human-readable export only, not a backup format that can be reloaded into the app.

**Attachments/receipts (blob URLs) after refresh — handled and communicated, not silent.** `URL.createObjectURL()` results are explicitly stripped before persisting:
- `sanitizeInvoiceForPersistence` drops `objectUrl` from every attachment before writing to localStorage — [src/data/mockInvoices.ts:115-120](src/data/mockInvoices.ts#L115-L120)
- `sanitizeExpenseForPersistence` does the same for receipts — [src/data/mockExpenses.ts:75-82](src/data/mockExpenses.ts#L75-L82)

This is because blob URLs are only valid for the browser session that created them and would 404 on reload anyway — stripping them is correct. The UI does detect and communicate the resulting missing preview rather than failing silently: `{attachment.objectUrl ? ... : <Text>Preview unavailable after browser refresh.</Text>}` — [src/app/invoices.tsx:280-284](src/app/invoices.tsx#L280-L284), and identically for receipts at [src/app/expenses.tsx:162-163](src/app/expenses.tsx#L162-L163). Both screens also offer an "Upload Again" action that re-attaches a fresh blob. The underlying file bytes are still gone forever (only the *name/type/size/date* metadata survives) — worth being explicit that this is metadata-only persistence, not real file storage, but the UX around it is honest about the limitation.

---

## 5. AUTH

**Critical — the "login" is entirely cosmetic; it does not check credentials and can be bypassed trivially.**

- `handleSignIn()` on the login screen ([src/app/login.tsx:11-21](src/app/login.tsx#L11-L21)) never reads the `email`/`password` state it collects. It performs no validation, no network call, and no comparison against anything — it unconditionally sets `localStorage['bcb_dev_logged_in'] = 'true'` and navigates to `/`. **Any input (including empty fields) "succeeds."**
- The only enforcement point is [src/app/_layout.tsx:10-23](src/app/_layout.tsx#L10-L23): a `useEffect` in the root layout that reads `bcb_dev_logged_in` from localStorage once, on mount, and calls `router.replace('/login')` if it isn't `'true'`. Because this runs in a `useEffect` (after the initial render), the protected route's content mounts and paints for one frame *before* the redirect fires — a real, if brief, flash of protected UI.
- This check runs **once, at root-layout mount** — it is not re-checked per navigation. Once `bcb_dev_logged_in` is set, it never expires and is never re-validated; the only way to clear it is the explicit "Sign Out" button in Settings ([src/app/settings.tsx:76-86](src/app/settings.tsx#L76-L86)), which just does `localStorage.removeItem('bcb_dev_logged_in')`.
- The flag is a plain client-side localStorage value with a hardcoded, guessable key — anyone with devtools access (or who just runs `localStorage.setItem('bcb_dev_logged_in', 'true')` in the console) has full access with zero credentials. The login screen itself is honest about this: `"Local dev login only. No real authentication yet."` — [src/app/login.tsx:29](src/app/login.tsx#L29).
- There is no session/user concept anywhere else in the codebase — no per-user data, no server, no token of any kind.

In short: `bcb_dev_logged_in` gates whether the root layout redirects to `/login`, and nothing else. It is not defense against anything; it's a placeholder for future real auth, currently functioning as a soft "have you clicked Sign In" flag.

---

## 6. DEAD CODE / CLEANUP

**html2pdf.js — actively used, not dead.** Contrary to what the name might suggest, this is live code: dynamically imported and invoked to generate the invoice PDF: `const { default: html2pdf } = await import('html2pdf.js'); ... await html2pdf()...` — [src/app/new-invoice.tsx:251-256](src/app/new-invoice.tsx#L251-L256). The type shim at [src/types/html2pdf.d.ts](src/types/html2pdf.d.ts) and the dependency in [package.json:29](package.json#L29) both support this real usage. Nothing to remove here.

**Unused Expo-scaffold routes/components left over from the template — confirmed dead, several files:**

| File | Status |
|---|---|
| [src/app/explore.tsx](src/app/explore.tsx) | Scaffold "Explore" tab screen. Not linked from `AppShell`'s nav ([src/components/AppShell.tsx:11-19](src/components/AppShell.tsx#L11-L19) lists only Dashboard/Invoices/Payments/Expenses/Customers/Reports/Settings). Still reachable at `/explore` because Expo Router file-based routing picks up any file under `src/app/`. |
| [src/components/app-tabs.tsx](src/components/app-tabs.tsx) | Scaffold native tab bar (`NativeTabs` with `index`/`explore` triggers). Not imported anywhere in `src/` outside its own file. |
| [src/components/app-tabs.web.tsx](src/components/app-tabs.web.tsx) | Web variant of the same, also unimported anywhere. |
| [src/components/themed-text.tsx](src/components/themed-text.tsx) | Only referenced by `explore.tsx` and the other unused scaffold components above — not used by any real screen (which all use `<Text>` from react-native directly). |
| [src/components/themed-view.tsx](src/components/themed-view.tsx) | Same — only used by the unused-scaffold cluster. |
| [src/components/external-link.tsx](src/components/external-link.tsx) | Only referenced by `explore.tsx`/`app-tabs.web.tsx`. |
| [src/components/web-badge.tsx](src/components/web-badge.tsx) | Only referenced by `explore.tsx`. |
| [src/components/ui/collapsible.tsx](src/components/ui/collapsible.tsx) | Only referenced by `explore.tsx`. |
| [src/components/hint-row.tsx](src/components/hint-row.tsx) | **Zero references anywhere in `src/`**, including from the other scaffold files. Completely orphaned. |

The real app doesn't use Expo Router's tab navigator at all — it uses a custom `AppShell` sidebar ([src/components/AppShell.tsx](src/components/AppShell.tsx)) inside a plain `Stack` ([src/app/_layout.tsx:28](src/app/_layout.tsx#L28)) — so this entire tab-based scaffold cluster (9 files) is inert leftover from `expo-router`'s default template.

Note: [src/components/animated-icon.tsx](src/components/animated-icon.tsx) / [.web.tsx](src/components/animated-icon.web.tsx) are **not** dead — `AnimatedSplashOverlay` from this file is used in `_layout.tsx:5,27`.

---

## 7. ADDITIONAL FINDINGS

**High — "Cash Available" ignores the bank-accounts data model entirely, and the two never reconcile.** The Dashboard computes `cashAvailable = startingCashBalance + paidThisMonth - moneyOut` ([src/app/index.tsx:48](src/app/index.tsx#L48)), where `startingCashBalance` is a hardcoded constant (`7850`, [src/data/mockBusiness.ts:97](src/data/mockBusiness.ts#L97)) that happens to equal only the "Business Checking" balance ([src/data/mockBankAccounts.ts:17](src/data/mockBankAccounts.ts#L17)) — the "Business Savings" balance (`12500`) is never included. Meanwhile the Dashboard separately renders each bank account's own `balance` field in a list ([src/app/index.tsx:316-324](src/app/index.tsx#L316-L324)). These are two independent numbers with no relationship: editing a bank account balance (via `saveBankAccounts`, [src/data/mockBankAccounts.ts:37-41](src/data/mockBankAccounts.ts#L37-L41)) would not move "Cash Available," and recording invoice payments doesn't touch the bank account balances either. Worth noting: `saveBankAccounts` is **exported but never called anywhere in the app** — there is no UI to edit a bank account balance at all, so the two figures are currently static/dead in different ways, but will actively contradict each other the moment either becomes editable.

**Medium — Dashboard "Needs Attention" list mixes computed and hardcoded fake data with no visual distinction.** [src/app/index.tsx:143-149](src/app/index.tsx#L143-L149): `overdueInvoiceLabel` and the "over 30 days past due" count are real, computed values, but the same list also unconditionally includes the literal strings `'12 expenses need categories'` and `'1 bank connection needs attention'` — static placeholder text with no backing computation anywhere in the codebase (no "category" validation on expenses exists, and there's no concept of a bank "connection" status). A user has no way to tell these apart from the real alerts next to them.

**Low — dead/unused hardcoded `metrics.value` fallback.** [src/app/index.tsx:21-27](src/app/index.tsx#L21-L27) defines a static `metrics` array with placeholder dollar amounts (`'$7,850'`, `'$1,750'`, etc.). The render logic at [src/app/index.tsx:259-270](src/app/index.tsx#L259-L270) branches on every one of the 5 known labels and substitutes a live computed value in each case, so `metric.value` is only ever reached by the unreachable `else` branch — it's dead weight that could mislead a future editor into thinking it's live.

**Low — `generateId()` is copy-pasted verbatim in three files** ([src/data/activityStore.ts:12-14](src/data/activityStore.ts#L12-L14), [src/data/mockExpenses.ts:51-53](src/data/mockExpenses.ts#L51-L53), [src/data/mockInvoices.ts:128-130](src/data/mockInvoices.ts#L128-L130)) — identical `Date.now().toString(36)-Math.random()...` implementation, not shared from a common module.

**Low — untracked `eslint.config.js` at repo root.** Not part of this audit's scope but noted since `git status` shows it as untracked (`??`) — flagging in case it was meant to be committed.
