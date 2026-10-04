import { afterEach, describe, expect, it } from 'vitest';
import { NATIVE_START, backAction, isNativeApp, isRootPath, publicOrigin } from '../src/lib/native.ts';

const g = globalThis as { Capacitor?: unknown };
afterEach(() => { delete g.Capacitor; });

describe('native app (Capacitor shell)', () => {
  it('is detected only inside the native app', () => {
    expect(isNativeApp()).toBe(false); // a browser has no Capacitor bridge
    g.Capacitor = { isNativePlatform: () => false }; // Capacitor's web fallback
    expect(isNativeApp()).toBe(false);
    g.Capacitor = { isNativePlatform: () => true };
    expect(isNativeApp()).toBe(true);
  });

  it('shares links with the public website origin inside the app, its own origin elsewhere', () => {
    const loc = globalThis as { location?: unknown };
    const had = 'location' in loc, prev = loc.location;
    loc.location = { origin: 'https://localhost' };
    try {
      expect(publicOrigin('https://preflop-staging-web.vercel.app/')).toBe('https://localhost'); // the website: its own origin
      g.Capacitor = { isNativePlatform: () => true };
      expect(publicOrigin('https://preflop-staging-web.vercel.app/')).toBe('https://preflop-staging-web.vercel.app');
      expect(publicOrigin(undefined)).toBe('https://localhost'); // no public origin configured: nothing better to use
    } finally {
      if (had) loc.location = prev; else delete loc.location;
    }
  });

  it('opens on the player app; top-level screens are the lobby and sign-in', () => {
    expect(NATIVE_START).toBe('/app');
    for (const p of ['/', '/app', '/login', '/register']) expect(isRootPath(p)).toBe(true);
    for (const p of ['/app/profile', '/app/table/x', '/terms']) expect(isRootPath(p)).toBe(false);
  });

  it('Android Back: closes a dialog first, then goes back, and leaves the app from a top-level screen', () => {
    expect(backAction(true, true, false)).toBe('close-dialog');
    expect(backAction(true, false, true)).toBe('close-dialog');
    expect(backAction(false, true, false)).toBe('back');
    expect(backAction(false, true, true)).toBe('minimize');
    expect(backAction(false, false, false)).toBe('minimize');
  });
});
