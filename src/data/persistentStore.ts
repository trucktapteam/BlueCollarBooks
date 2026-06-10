const isWebStorageSupported = typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

export function loadPersistedData<T>(key: string, fallback: T): T {
  if (!isWebStorageSupported) {
    return fallback;
  }

  try {
    const storedValue = window.localStorage.getItem(key);
    if (!storedValue) {
      return fallback;
    }

    return JSON.parse(storedValue) as T;
  } catch {
    return fallback;
  }
}

export function persistData<T>(key: string, data: T) {
  if (!isWebStorageSupported) {
    return;
  }

  try {
    window.localStorage.setItem(key, JSON.stringify(data));
  } catch {
    // Ignore storage failures in environments without localStorage permission.
  }
}
