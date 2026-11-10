import { afterEach, describe, expect, it, vi } from 'vitest';
import { type Identity, loadIdentity, saveIdentity } from '../src/lib/keystore.ts';

/** Just enough of IndexedDB for keystore.ts: one store, put/get, requests that settle on the next tick. */
function fakeIndexedDB() {
  const data = new Map<IDBValidKey, unknown>();
  const transaction = () => {
    const t = { oncomplete: null as null | (() => void), onerror: null, onabort: null, objectStore: () => store };
    const done = <T,>(result: T) => { queueMicrotask(() => t.oncomplete?.()); return { result }; };
    const store = {
      put: (v: unknown, k: IDBValidKey) => { data.set(k, v); return done(k); },
      get: (k: IDBValidKey) => done(data.get(k)),
    };
    return t;
  };
  const db = { createObjectStore: () => {}, close: () => {}, transaction };
  return {
    data,
    open: () => {
      const r = { result: db, onsuccess: null as null | (() => void), onerror: null, onupgradeneeded: null };
      queueMicrotask(() => r.onsuccess?.());
      return r;
    },
  };
}

const identity = { config: { apiUrl: 'https://api.test', tableId: 't1', personId: 'p1', role: 'dealer', publicKeyPem: 'pem', fingerprint: 'fp', createdAt: 1 }, keys: {} } as unknown as Identity;

afterEach(() => vi.unstubAllGlobals());

describe('F7: the tablet identity asks for persistent storage', () => {
  it('saveIdentity stores the identity, then calls navigator.storage.persist() without waiting for it', async () => {
    const idb = fakeIndexedDB();
    vi.stubGlobal('indexedDB', idb);
    const persist = vi.fn(() => new Promise<boolean>(() => {})); // never answers: the save must not block on it
    vi.stubGlobal('navigator', { storage: { persist } });
    await saveIdentity(identity);
    expect(persist).toHaveBeenCalledOnce();
    expect(await loadIdentity()).toBe(identity);
  });

  it('a browser without the Storage API saves all the same', async () => {
    vi.stubGlobal('indexedDB', fakeIndexedDB());
    vi.stubGlobal('navigator', {});
    await expect(saveIdentity(identity)).resolves.toBe('self');
  });

  it('a refused request is ignored', async () => {
    vi.stubGlobal('indexedDB', fakeIndexedDB());
    vi.stubGlobal('navigator', { storage: { persist: () => Promise.reject(new Error('no')) } });
    await expect(saveIdentity(identity)).resolves.toBe('self');
    await new Promise((r) => setTimeout(r, 0)); // the rejection is swallowed, never unhandled
  });
});
