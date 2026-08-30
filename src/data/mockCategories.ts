import { useSyncExternalStore } from 'react';
import { getCurrentUserId } from './authStore';
import { generateId } from '@/utils/id';
import { supabase } from '@/lib/supabase';

// User-editable expense categories. This used to be a hardcoded 9-value
// array (expenseCategories in mockExpenses.ts) - every shop's expenses look
// a little different, so the list now lives per-user in Supabase and can be
// added to or trimmed from Settings. Expense.category itself is still free
// text with no foreign key, so deleting a category here never touches any
// expense that already used it.
export const DEFAULT_CATEGORIES = ['Fuel', 'Repairs', 'Insurance', 'Permits', 'Tolls', 'Meals', 'Office', 'Software', 'Other'];

export type Category = {
  id: string;
  name: string;
};

type CategoryRow = {
  id: string;
  name: string;
};

let categoriesSnapshot: Category[] = [];
const listeners = new Set<() => void>();

function emitChange() {
  listeners.forEach((listener) => listener());
}

export async function loadCategories(userId: string) {
  const { data, error } = await supabase
    .from('expense_categories')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Failed to load expense categories', error);
    return;
  }

  // Brand-new account with no categories yet (migration only seeded users
  // that existed when this shipped) - give them the same starting list
  // everyone else got, which they're then free to edit.
  if (!data || data.length === 0) {
    const { data: seeded, error: seedError } = await supabase
      .from('expense_categories')
      .insert(DEFAULT_CATEGORIES.map((name) => ({ id: generateId(), user_id: userId, name })))
      .select('*');

    if (seedError) {
      console.error('Failed to seed default expense categories', seedError);
      categoriesSnapshot = [];
      emitChange();
      return;
    }

    categoriesSnapshot = (seeded ?? []).map((row: CategoryRow) => ({ id: row.id, name: row.name }));
    emitChange();
    return;
  }

  categoriesSnapshot = data.map((row: CategoryRow) => ({ id: row.id, name: row.name }));
  emitChange();
}

export function clearCategories() {
  categoriesSnapshot = [];
  emitChange();
}

export async function addCategory(name: string) {
  const userId = getCurrentUserId();
  if (!userId) {
    throw new Error('You must be signed in to add a category.');
  }

  const trimmed = name.trim();
  if (!trimmed) {
    return;
  }
  if (categoriesSnapshot.some((c) => c.name.toLowerCase() === trimmed.toLowerCase())) {
    return;
  }

  const category: Category = { id: generateId(), name: trimmed };
  const { error } = await supabase.from('expense_categories').insert({
    id: category.id,
    user_id: userId,
    name: category.name,
  });

  if (error) {
    console.error('Failed to add expense category', error);
    throw error;
  }

  categoriesSnapshot = [...categoriesSnapshot, category];
  emitChange();
}

export async function deleteCategory(categoryId: string) {
  const userId = getCurrentUserId();
  if (!userId) {
    throw new Error('You must be signed in to remove a category.');
  }

  const { error } = await supabase.from('expense_categories').delete().eq('id', categoryId).eq('user_id', userId);

  if (error) {
    console.error('Failed to remove expense category', error);
    throw error;
  }

  categoriesSnapshot = categoriesSnapshot.filter((c) => c.id !== categoryId);
  emitChange();
}

export function useCategories() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => categoriesSnapshot,
    () => categoriesSnapshot
  );
}
