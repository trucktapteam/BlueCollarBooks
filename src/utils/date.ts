// Dates are stored internally as ISO 'YYYY-MM-DD' strings everywhere (see the
// migration notes in each store). This is the one place date parsing and
// formatting happens - the audit found 4+ near-duplicate copies of this
// parsing logic scattered across screens, each with slightly different
// fallback behavior, so a date that failed to parse in one copy could be
// silently treated differently (e.g. dumped into a different A/R aging
// bucket) than the same date parsed by a different copy elsewhere.

// Parses flexible input - ISO ('2026-04-01'), MM/DD/YYYY ('4/1/2026'), or a
// long-form date like 'Apr 1, 2026' - into a Date. Returns null if nothing
// could be parsed, rather than silently producing an invalid/garbage date.
export function parseFlexibleDate(input?: string): Date | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Bare ISO 'YYYY-MM-DD' is parsed as LOCAL date components, not via
  // Date.parse(). Date.parse() treats a bare ISO date string as UTC
  // midnight; reading it back with local getters (getFullYear/getMonth/
  // getDate, which toLocaleDateString and this file's own formatters use)
  // then shows the previous day in any timezone west of UTC - i.e. every US
  // timezone. A calendar date like an invoice date has no inherent
  // timezone, so it should round-trip as the literal day typed in, not
  // shift by a day depending on where the app happens to be running.
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    const date = new Date(Number(year), Number(month) - 1, Number(day));
    if (!Number.isNaN(date.getTime())) return date;
  }

  const parts = trimmed.split('/').map((part) => Number(part));
  if (parts.length === 3 && parts.every((part) => Number.isFinite(part))) {
    const [month, day, year] = parts;
    const date = new Date(year, month - 1, day);
    if (!Number.isNaN(date.getTime())) return date;
  }

  // Everything else (long-form dates like "Apr 1, 2026", full ISO
  // datetimes with a time component such as activity timestamps) goes
  // through Date.parse, which handles those correctly.
  const parsed = Date.parse(trimmed);
  if (!Number.isNaN(parsed)) return new Date(parsed);

  return null;
}

export function toISODateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Normalizes flexible user input into ISO 'YYYY-MM-DD' for storage. Falls
// back to returning the original input unchanged if it can't be parsed,
// rather than silently discarding what the user typed.
export function normalizeDateToISO(input?: string): string {
  const date = parseFlexibleDate(input);
  return date ? toISODateString(date) : (input?.trim() ?? '');
}

// Friendly display format for a stored ISO date, e.g. "Apr 1, 2026".
export function formatDateDisplay(input?: string): string {
  const date = parseFlexibleDate(input);
  return date ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : (input ?? '');
}

export function isSameMonthAsDate(input: string, comparisonDate: Date): boolean {
  const parsed = parseFlexibleDate(input);
  return !!parsed && parsed.getFullYear() === comparisonDate.getFullYear() && parsed.getMonth() === comparisonDate.getMonth();
}

export function isSameYearAsDate(input: string, comparisonDate: Date): boolean {
  const parsed = parseFlexibleDate(input);
  return !!parsed && parsed.getFullYear() === comparisonDate.getFullYear();
}

export function addDays(date: Date, days: number): Date {
  const result = new Date(date.getTime());
  result.setDate(result.getDate() + days);
  return result;
}

export function parseTermsToDays(terms?: string): number {
  if (!terms) return 0;
  const match = terms.match(/(\d+)/);
  return match ? Number(match[1]) : 0;
}

// Shared due-date math, used by the dashboard, invoice list, invoice form,
// and reports - previously reimplemented separately in each of those files.
export function computeDueDate(invoiceDate: string, terms?: string): Date | null {
  const parsed = parseFlexibleDate(invoiceDate);
  return parsed ? addDays(parsed, parseTermsToDays(terms)) : null;
}

export function formatDueDateDisplay(invoiceDate: string, terms?: string): string {
  const due = computeDueDate(invoiceDate, terms);
  return due ? formatDateDisplay(toISODateString(due)) : '';
}
