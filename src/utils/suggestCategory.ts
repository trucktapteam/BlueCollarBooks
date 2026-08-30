import { expenseCategories } from '@/data/mockExpenses';

// Best-effort mapping from Plaid's own category labels to this app's fixed
// nine-value expense taxonomy (see expenseCategories in mockExpenses.ts).
// Plaid's transactions carry a `personal_finance_category.primary` value
// (their newer, more granular taxonomy) and/or a legacy `category` array -
// neither lines up with ours, so this is a keyword match against whichever
// string we got, not an exact lookup table. It only ever returns one of our
// own category names (or 'Other') - never a raw Plaid label - so a bad
// match just falls back to a normal, editable suggestion rather than
// polluting the Money Out By Type report with an unfamiliar category.
const KEYWORD_RULES: Array<{ category: (typeof expenseCategories)[number]; keywords: string[] }> = [
  { category: 'Fuel', keywords: ['gas station', 'gas_stations', 'fuel'] },
  {
    category: 'Repairs',
    keywords: ['automotive', 'auto repair', 'auto maintenance', 'car repair', 'repair and maintenance', 'hardware'],
  },
  { category: 'Insurance', keywords: ['insurance'] },
  { category: 'Tolls', keywords: ['toll', 'parking', 'tolls and parking'] },
  {
    category: 'Meals',
    keywords: ['restaurant', 'food and drink', 'food_and_drink', 'coffee', 'fast food', 'dining'],
  },
  {
    category: 'Office',
    keywords: ['office supplies', 'office_supplies', 'shipping', 'postage', 'print'],
  },
  {
    category: 'Software',
    keywords: ['software', 'subscription', 'saas', 'cloud', 'web hosting'],
  },
];

// Plaid gives us a couple of shapes to work with: the newer
// `personal_finance_category` object ({ primary, detailed }) and the older
// `category` string array (e.g. ['Travel', 'Gas Stations']). Callers pass
// whichever they have as a flat list of label strings.
export function suggestExpenseCategory(plaidLabels: Array<string | null | undefined>): string {
  const haystack = plaidLabels
    .filter((label): label is string => Boolean(label))
    .join(' ')
    .toLowerCase()
    .replace(/_/g, ' ');

  if (!haystack) {
    return 'Other';
  }

  for (const rule of KEYWORD_RULES) {
    if (rule.keywords.some((keyword) => haystack.includes(keyword))) {
      return rule.category;
    }
  }

  return 'Other';
}
