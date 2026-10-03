import { describe, expect, it, vi } from 'vitest';
import { inertSiblings, restoreFocus, trapIndex, trapTab } from '../src/lib/focus.ts';

/** Minimal stand-ins for DOM elements: focus() records the element as the active one. */
function fakeDom(n: number) {
  let active: unknown = null;
  const items = Array.from({ length: n }, (_, i) => {
    const el = { name: `b${i}`, focus: vi.fn(() => { active = el; }), getAttribute: () => null, closest: () => null, getClientRects: () => [1] };
    return el;
  });
  const root = { name: 'dialog', focus: vi.fn(() => { active = root; }), querySelectorAll: () => items, contains: (x: unknown) => x === root || items.includes(x as never) };
  return { root, items, active: () => active };
}
const tab = (shiftKey = false) => ({ key: 'Tab', shiftKey, preventDefault: vi.fn() });

describe('F18: dialog focus containment', () => {
  it('trapIndex wraps at both ends and pulls focus in from the dialog itself', () => {
    expect(trapIndex(3, 2, false)).toBe(0);
    expect(trapIndex(3, 0, true)).toBe(2);
    expect(trapIndex(3, 1, false)).toBeNull();
    expect(trapIndex(3, 1, true)).toBeNull();
    expect(trapIndex(3, -1, false)).toBe(0);
    expect(trapIndex(3, -1, true)).toBe(2);
    expect(trapIndex(0, -1, false)).toBe(-1);
  });

  it('Tab from the last control goes to the first; Shift+Tab from the first goes to the last', () => {
    const d = fakeDom(3);
    const e1 = tab();
    expect(trapTab(d.root, e1, d.items[2])).toBe(true);
    expect(e1.preventDefault).toHaveBeenCalled();
    expect(d.active()).toBe(d.items[0]);
    const e2 = tab(true);
    expect(trapTab(d.root, e2, d.items[0])).toBe(true);
    expect(d.active()).toBe(d.items[2]);
  });

  it('Tab in the middle is left to the browser', () => {
    const d = fakeDom(3);
    const e = tab();
    expect(trapTab(d.root, e, d.items[1])).toBe(false);
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it('focus outside the dialog (or on the dialog) is pulled back in', () => {
    const d = fakeDom(2);
    expect(trapTab(d.root, tab(), { outside: true })).toBe(true);
    expect(d.active()).toBe(d.items[0]);
    expect(trapTab(d.root, tab(true), d.root)).toBe(true);
    expect(d.active()).toBe(d.items[1]);
  });

  it('with nothing focusable, focus stays on the dialog', () => {
    const d = fakeDom(0);
    const e = tab();
    expect(trapTab(d.root, e, d.root)).toBe(true);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(d.active()).toBe(d.root);
  });

  it('other keys are ignored', () => {
    const d = fakeDom(2);
    expect(trapTab(d.root, { key: 'Enter', shiftKey: false, preventDefault: vi.fn() }, d.items[1])).toBe(false);
  });
});

describe('F18: inert background and focus restore', () => {
  it('makes every other child inert and restores each previous value (nested dialogs)', () => {
    const app = { inert: false };
    const toast = { inert: true };
    const outer = { inert: false };
    const body = { children: [app, toast, outer] as { inert: boolean }[] };
    const undoOuter = inertSiblings(body, outer);
    expect(app.inert).toBe(true);
    expect(outer.inert).toBe(false);
    const inner = { inert: false };
    body.children.push(inner);
    const undoInner = inertSiblings(body, inner);
    expect(outer.inert).toBe(true);
    expect(inner.inert).toBe(false);
    undoInner();
    expect(outer.inert).toBe(false);
    expect(app.inert).toBe(true); // still under the outer dialog
    undoOuter();
    expect(app.inert).toBe(false);
    expect(toast.inert).toBe(true); // was inert before any dialog
  });

  it('returns focus to the opener only if it is still on the page', () => {
    const opener = { focus: vi.fn(), isConnected: true };
    restoreFocus(opener);
    expect(opener.focus).toHaveBeenCalledOnce();
    const gone = { focus: vi.fn(), isConnected: false };
    restoreFocus(gone);
    expect(gone.focus).not.toHaveBeenCalled();
    expect(() => restoreFocus(null)).not.toThrow();
  });
});
