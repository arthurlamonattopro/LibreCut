import { create } from "zustand";

/**
 * A single place to send short messages to a screen reader.
 *
 * The editor is a dense workbench, so the alternative to announcing state is
 * silence: a render that finishes, an import that fails, or a clip that was
 * split all have to say so out loud.
 */

export interface Announcement {
  id: number;
  text: string;
}

interface LiveState {
  polite: Announcement | null;
  assertive: Announcement | null;
  announce: (text: string, options?: { assertive?: boolean }) => void;
}

let counter = 0;

export const useLiveRegion = create<LiveState>((set) => ({
  polite: null,
  assertive: null,
  announce: (text, options) => {
    counter += 1;
    const entry: Announcement = { id: counter, text };
    if (options?.assertive) set({ assertive: entry });
    else set({ polite: entry });
  },
}));

/**
 * Announces a message to assistive technology.
 *
 * Polite messages wait for a pause in the speech; assertive messages cut
 * through it and are reserved for failures.
 */
export function announce(text: string, options?: { assertive?: boolean }): void {
  if (!text) return;
  useLiveRegion.getState().announce(text, options);
}
