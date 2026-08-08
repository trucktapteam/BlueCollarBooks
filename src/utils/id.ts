// Generates a short, sufficiently-unique local id for records created on this device.
// Not a UUID - fine for local-only data. Revisit if/when records need to be
// globally unique across devices (e.g. once a real backend exists).
export function generateId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
