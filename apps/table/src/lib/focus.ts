/**
 * Focus handling for modal sheets (components/controls.tsx Sheet): Tab and Shift+Tab stay inside
 * the dialog, everything else on the page is inert while it is open, and focus goes back to where
 * it was when the dialog closes. The DOM parts take plain interfaces so they can be tested without
 * a browser.
 */

export const FOCUSABLE = [
  'a[href]', 'area[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])', 'select:not([disabled])',
  'textarea:not([disabled])', 'iframe', 'audio[controls]', 'video[controls]', '[contenteditable]:not([contenteditable="false"])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Index of the element Tab (or Shift+Tab) must move to, or null to let the browser move focus
 * normally. `active` is the index of the focused element among `count` focusables, or -1 when
 * focus is on the dialog itself or outside it.
 */
export function trapIndex(count: number, active: number, shift: boolean): number | null {
  if (count === 0) return -1; // nothing to tab to: keep focus on the dialog
  if (active < 0) return shift ? count - 1 : 0;
  if (shift && active === 0) return count - 1;
  if (!shift && active === count - 1) return 0;
  return null;
}

export interface FocusTarget { focus(o?: FocusOptions): void }
interface FocusRoot extends FocusTarget { querySelectorAll(sel: string): ArrayLike<unknown>; contains(n: unknown): boolean }

/** Focusable, visible descendants of `root`, in DOM order. */
export function focusables(root: FocusRoot): FocusTarget[] {
  return Array.from(root.querySelectorAll(FOCUSABLE) as ArrayLike<HTMLElement>).filter((el) =>
    !el.closest?.('[inert]') && el.getAttribute?.('aria-hidden') !== 'true' && (el.getClientRects ? el.getClientRects().length > 0 : true));
}

/**
 * Handles Tab / Shift+Tab inside `root`: wraps at the ends and pulls focus back in when it is on
 * the dialog itself or has escaped. Returns true when it moved focus (the event was handled).
 */
export function trapTab(root: FocusRoot, e: { key: string; shiftKey: boolean; preventDefault(): void }, active: unknown): boolean {
  if (e.key !== 'Tab') return false;
  const items = focusables(root);
  const idx = items.indexOf(active as FocusTarget);
  const next = trapIndex(items.length, idx, e.shiftKey);
  if (next === null) return false;
  e.preventDefault();
  (next < 0 ? root : items[next]!).focus();
  return true;
}

interface InertNode { inert: boolean }
interface InertParent { children: ArrayLike<unknown> }

/**
 * Makes every child of `parent` except `keep` inert (no focus, no clicks, hidden from assistive
 * tech). Returns a function that puts back each node's previous value, so nested dialogs undo in
 * the right order.
 */
export function inertSiblings(parent: InertParent, keep: InertNode): () => void {
  const changed: [InertNode, boolean][] = [];
  for (const n of Array.from(parent.children) as InertNode[]) {
    if (n === keep) continue;
    changed.push([n, n.inert]);
    n.inert = true;
  }
  return () => { for (const [n, was] of changed) n.inert = was; };
}

/** Focuses `prev` again if it is still in the document (the opener of a dialog that closed). */
export function restoreFocus(prev: (FocusTarget & { isConnected?: boolean }) | null | undefined): void {
  if (prev && prev.isConnected !== false) prev.focus({ preventScroll: true });
}
