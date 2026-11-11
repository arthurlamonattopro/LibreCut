export const FIRST_RUN_KEY = "librecut:first-run:v1";

type ReadableStorage = Pick<Storage, "getItem">;
type WritableStorage = Pick<Storage, "setItem" | "removeItem">;

function defaultStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** If storage is unavailable, treat onboarding as seen so we never trap the user in a modal. */
export function hasSeenFirstRun(storage: ReadableStorage | null = defaultStorage()): boolean {
  if (!storage) return true;
  try {
    return storage.getItem(FIRST_RUN_KEY) === "done";
  } catch {
    return true;
  }
}

export function markFirstRunSeen(storage: WritableStorage | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(FIRST_RUN_KEY, "done");
  } catch {
    // Onboarding state is a convenience; storage failures must not break the app.
  }
}

export function resetFirstRun(storage: WritableStorage | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(FIRST_RUN_KEY);
  } catch {
    // Ignore storage failures.
  }
}
