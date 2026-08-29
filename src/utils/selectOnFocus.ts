import type { FocusEvent } from 'react-native';
import { Platform } from 'react-native';

// Money fields start pre-filled with a placeholder value like "$0" or a
// previous balance. Without this, clicking into the field on web drops the
// cursor at the click position instead of selecting the existing text, so
// typing inserts digits next to the stale value instead of replacing it
// (e.g. typing "89" into "$0" becomes "$089"). Selecting the full value on
// focus makes the first keystroke replace it, matching how most money
// inputs behave. RN's cross-platform FocusEvent types `target` as a native
// tag number, but react-native-web's TextInput actually hands back the real
// DOM <input>/<textarea> element at runtime, which has .select() - hence
// the cast. No-op off web.
export function selectTextOnFocus(event: FocusEvent) {
  if (Platform.OS !== 'web') return;
  const target = event.target as unknown as { select?: () => void } | undefined;
  target?.select?.();
}
