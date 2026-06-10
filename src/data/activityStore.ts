import { useSyncExternalStore } from 'react';
import { loadPersistedData, persistData } from './persistentStore';

export type Activity = {
  id: string;
  message: string;
  timestamp: string; // ISO
};

const LOCAL_STORAGE_KEY = 'bluecollarbooks_activity';

function generateId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

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
