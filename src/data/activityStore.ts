import { useSyncExternalStore } from 'react';
import { loadPersistedData, persistData } from './persistentStore';
import { generateId } from '@/utils/id';

export type Activity = {
  id: string;
  message: string;
  timestamp: string; // ISO
};

const LOCAL_STORAGE_KEY = 'bluecollarbooks_activity';

const initialActivities: Activity[] = [];

let activitiesSnapshot = loadPersistedData<Activity[]>(LOCAL_STORAGE_KEY, initialActivities);
const listeners = new Set<() => void>();

function emitChange() {
  listeners.forEach((listener) => listener());
}

export function addActivity(message: string) {
  const activity: Activity = {
    id: generateId(),
    message,
    timestamp: new Date().toISOString(),
  };

  activitiesSnapshot = [activity, ...activitiesSnapshot].slice(0, 200);
  persistData(LOCAL_STORAGE_KEY, activitiesSnapshot);
  emitChange();
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

export function clearActivities() {
  activitiesSnapshot = [];
  persistData(LOCAL_STORAGE_KEY, activitiesSnapshot);
  emitChange();
}
