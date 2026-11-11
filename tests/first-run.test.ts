import { describe, expect, it } from "vitest";
import {
  FIRST_RUN_KEY,
  hasSeenFirstRun,
  markFirstRunSeen,
  resetFirstRun,
} from "../src/lib/firstRun";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
}

describe("first-run guidance state", () => {
  it("shows guidance until it is completed", () => {
    const storage = memoryStorage();
    expect(hasSeenFirstRun(storage)).toBe(false);
    markFirstRunSeen(storage);
    expect(hasSeenFirstRun(storage)).toBe(true);
    expect(storage.data.get(FIRST_RUN_KEY)).toBe("done");
  });

  it("can be reset from settings", () => {
    const storage = memoryStorage({ [FIRST_RUN_KEY]: "done" });
    resetFirstRun(storage);
    expect(hasSeenFirstRun(storage)).toBe(false);
  });

  it("does not trap the user when storage is unavailable", () => {
    expect(hasSeenFirstRun(null)).toBe(true);
    expect(() => markFirstRunSeen(null)).not.toThrow();
    expect(() => resetFirstRun(null)).not.toThrow();
  });

  it("does not throw when storage access fails", () => {
    const throwing = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(hasSeenFirstRun(throwing)).toBe(true);
    expect(() => markFirstRunSeen(throwing)).not.toThrow();
    expect(() => resetFirstRun(throwing)).not.toThrow();
  });
});
