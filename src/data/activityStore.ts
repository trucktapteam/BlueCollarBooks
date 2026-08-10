import { useSyncExternalStore } from 'react';
import { getCurrentUserId } from './authStore';
import { generateId } from '@/utils/id';
import { supabase } from '@/lib/supabase';

export type Activity = {
  id: string;
  message: string;
  timestamp: string; // ISO
};

type ActivityRow = {
  id: string;
  message: string;
  created_at: string;
};

function rowToActivity(row: ActivityRow): Activity {
  return { id: row.id, message: row.message, timestamp: row.created_at };
}

let activitiesSnapshot: Activity[] = [];
const listeners = new Set<() => void>();

function emitChange() {
  listeners.forEach((listener) => listener());
}

export async function loadActivities(userId: string) {
  const { data, error } = await supabase
    .from('activity_log')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    console.error('Failed to load activity log', error);
    return;
  }

  activitiesSnapshot = (data ?? []).map(rowToActivity);
  emitChange();
}

export function clearActivities() {
  activitiesSnapshot = [];
  emitChange();
}

// Fire-and-forget by design (matches the old localStorage version): every
// other mutation in the app calls this as a side note after its own save
// succeeds, and none of them should fail or block on an activity-log write.
export function addActivity(message: string) {
  const userId = getCurrentUserId();
  if (!userId) {
    return;
  }

  const activity: Activity = {
    id: generateId(),
    message,
    timestamp: new Date().toISOString(),
  };

  activitiesSnapshot = [activity, ...activitiesSnapshot].slice(0, 200);
  emitChange();

  supabase
    .from('activity_log')
    .insert({ id: activity.id, user_id: userId, message: activity.message, created_at: activity.timestamp })
    .then(({ error }) => {
      if (error) console.error('Failed to persist activity log entry', error);
    });
}

export function useActivities() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => activitiesSnapshot,
    () => activitiesSnapshot
  );
}
