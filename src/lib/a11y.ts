/**
 * Accessibility helpers shared by the editor surfaces.
 *
 * The helpers stay free of React so the focus rules can be unit tested
 * without a DOM, and so the dialogs, the timeline, and the panels can all
 * use the same rules.
 */

/** Elements that can hold keyboard focus, in the order they are matched. */
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

/** The dialogs that are open right now, oldest first. */
const openDialogs: HTMLElement[] = [];

/** Marks a dialog as open so only the topmost one reacts to Escape. */
export function registerDialog(element: HTMLElement): void {
  const index = openDialogs.indexOf(element);
  if (index >= 0) openDialogs.splice(index, 1);
  openDialogs.push(element);
}

/** Marks a dialog as closed. */
export function unregisterDialog(element: HTMLElement): void {
  const index = openDialogs.indexOf(element);
  if (index >= 0) openDialogs.splice(index, 1);
}

/** True when the element is the dialog the user is currently working in. */
export function isTopDialog(element: HTMLElement): boolean {
  return openDialogs[openDialogs.length - 1] === element;
}

/**
 * True while a modal dialog is open.
 *
 * Editor shortcuts check this so a dialog owns the keyboard while it is up.
 */
export function hasOpenDialog(): boolean {
  return openDialogs.length > 0;
}

/** The focusable elements inside a container, in tab order. */
export function focusableElements(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => element.getAttribute("aria-hidden") !== "true",
  );
}

/**
 * Keeps Tab and Shift+Tab inside a container.
 *
 * Returns true when the event was handled, so the caller knows the browser
 * default was replaced.
 */
export function trapFocus(event: KeyboardEvent, root: HTMLElement): boolean {
  if (event.key !== "Tab") return false;
  const elements = focusableElements(root);
  if (!elements.length) {
    event.preventDefault();
    root.focus();
    return true;
  }
  const first = elements[0];
  const last = elements[elements.length - 1];
  const active = document.activeElement;
  if (!active || !root.contains(active)) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
    return true;
  }
  if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
    return true;
  }
  if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
    return true;
  }
  return false;
}

/**
 * Moves focus to an element without scrolling the page under the pointer.
 *
 * The timeline scrolls its own surface, so the browser default would jump
 * the whole window.
 */
export function focusWithoutScroll(element: HTMLElement | null): void {
  element?.focus({ preventScroll: true });
}
