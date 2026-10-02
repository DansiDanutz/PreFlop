/**
 * Tablet identity, persisted in IndexedDB. The CryptoKeyPair is stored as-is (CryptoKey is
 * structured-cloneable); its private key was generated with extractable: false, so it can sign
 * but its bytes can never be read back — not by this app, not by devtools export.
 */
import type { PinRecord } from './pin.ts';

export type Role = 'dealer' | 'floor' | 'floor_manager';

export interface TabletConfig {
  apiUrl: string;
  tableId: string;
  personId: string;
  role: Role;
  /** Set once the club admin has enrolled the public key and the tablet verified it. */
  credentialId?: string;
  publicKeyPem: string;
  fingerprint: string;
  createdAt: number;
}

export interface Identity {
  config: TabletConfig;
  keys: CryptoKeyPair;
  /** Staff PIN hash (lib/pin.ts); set right after enrollment. Deleted with the key on reset. */
  pin?: PinRecord;
  /** Auto-lock after this many idle minutes (lib/lock.ts DEFAULT_IDLE_MIN when absent). */
  idleMinutes?: number;
}

const DB = 'preflop-table';
const STORE = 'identity';
const KEY = 'self';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await open();
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req.result as T);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}

export const loadIdentity = () => run<Identity | undefined>('readonly', (s) => s.get(KEY));
export const saveIdentity = (id: Identity) => run<IDBValidKey>('readwrite', (s) => s.put(id, KEY));
/** "Reset this tablet": the private key is deleted and cannot be recovered. */
export const deleteIdentity = () => run<undefined>('readwrite', (s) => s.delete(KEY));

export const ROLE_LABEL: Record<Role, string> = { dealer: 'Dealer', floor: 'Floor', floor_manager: 'Floor manager' };
