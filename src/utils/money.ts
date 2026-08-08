// Money is stored internally as integer cents everywhere (e.g. $625.00 = 62500).
// This is the one place formatting/parsing happens - screens should not build
// their own "$" strings or call toLocaleString() on a dollar number directly.
// (The audit found 3 different ad-hoc formatting styles scattered across the
// app that could render the same amount differently depending on the screen.)

export function formatMoneyCents(cents: number): string {
  const dollars = cents / 100;
  return dollars.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: Number.isInteger(dollars) ? 0 : 2,
    maximumFractionDigits: 2,
  });
}

// Parses user-typed input like "$625", "625.50", "1,234.5" into integer cents.
// Anything unparseable resolves to 0 rather than throwing, since this is used
// live while someone is still typing into a field.
export function parseMoneyInputToCents(input: string): number {
  const cleaned = input.replace(/[$,]/g, '').trim();
  const dollars = Number(cleaned);
  if (!Number.isFinite(dollars)) return 0;
  return Math.round(dollars * 100);
}

// One-time conversion helpers for migrating old dollar-number fields to cents.
export function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100);
}
