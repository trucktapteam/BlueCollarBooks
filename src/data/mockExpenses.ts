export const expenseCategories = [
  'Fuel',
  'Repairs',
  'Insurance',
  'Permits',
  'Tolls',
  'Meals',
  'Office',
  'Software',
  'Other',
];

export const expenseDraft = {
  date: '06/09/2026',
  vendor: 'Loves Travel Stop',
  category: 'Fuel',
  amount: '$324',
  notes: 'Diesel fill-up',
};

export const expenses = [
  { date: '06/09/2026', vendor: 'Loves Travel Stop', category: 'Fuel', amount: 324, notes: 'Diesel fill-up' },
  { date: '06/08/2026', vendor: 'NAPA Auto Parts', category: 'Repairs', amount: 89, notes: 'Replacement parts' },
  { date: '06/07/2026', vendor: 'Supabase', category: 'Software', amount: 25, notes: 'Monthly tools' },
  { date: '06/06/2026', vendor: 'Google Play', category: 'Software', amount: 25, notes: 'App publishing' },
];

export const totalMonthlyExpenses = expenses.reduce((total, expense) => total + expense.amount, 0);
