import { ROLE_LABEL, type Role, type TabletConfig } from './keystore.ts';

/**
 * Credentials this tablet stopped using (reset, or re-enrolled with a new key) that the club admin
 * still has to revoke. The key is gone from the tablet, but the server keeps accepting the old
 * credential until it is revoked in the club console (docs/12 §7a runbook). Kept in localStorage,
 * so the reminder survives the reset that deleted the identity, until someone confirms the revoke.
 */
export interface RetiredCredential {
  /** Null when the key was never verified on this tablet (the admin may still have enrolled it). */
  credentialId: string | null;
  role: Role;
  personId: string;
  tableId: string;
  fingerprint: string;
  retiredAt: number;
}

export interface RetiredStore { get(): RetiredCredential[]; set(v: RetiredCredential[]): void }

/** Where the club admin revokes a staff credential (apps/console club portal, Staff page). */
export const CONSOLE_REVOKE_PATH = 'Club console → Staff & devices → Staff credentials → Revoke';

/** Records the credential being retired. Same credential (or same key) twice is kept once. */
export function retireCredential(c: TabletConfig, store: RetiredStore, now = Date.now()): RetiredCredential[] {
  const rec: RetiredCredential = { credentialId: c.credentialId ?? null, role: c.role, personId: c.personId, tableId: c.tableId, fingerprint: c.fingerprint, retiredAt: now };
  const list = store.get().filter((x) => !(x.fingerprint === rec.fingerprint && x.credentialId === rec.credentialId));
  const next = [...list, rec].slice(-10);
  store.set(next);
  return next;
}

/** The admin confirmed the revoke: stop reminding. */
export function confirmRevoked(r: Pick<RetiredCredential, 'credentialId' | 'fingerprint'>, store: RetiredStore): RetiredCredential[] {
  const next = store.get().filter((x) => !(x.fingerprint === r.fingerprint && x.credentialId === r.credentialId));
  store.set(next);
  return next;
}

/** Plain instruction for the club admin. */
export function revokeInstruction(r: RetiredCredential): string {
  const who = `${ROLE_LABEL[r.role]} · ${r.personId} · table ${r.tableId}`;
  return r.credentialId
    ? `Club admin: revoke credential ${r.credentialId} (${who}) in ${CONSOLE_REVOKE_PATH}. Until it is revoked, the server still accepts that credential.`
    : `Club admin: if you already enrolled the key with fingerprint ${r.fingerprint.slice(0, 16)} (${who}), revoke that credential in ${CONSOLE_REVOKE_PATH}.`;
}

export function localRetiredStore(key = 'pf.table.retired'): RetiredStore {
  return {
    get() {
      try {
        const v = JSON.parse(localStorage.getItem(key) ?? '[]') as unknown;
        return Array.isArray(v) ? (v as RetiredCredential[]).filter((x) => x && typeof x.fingerprint === 'string' && typeof x.role === 'string') : [];
      } catch { return []; }
    },
    set(v) {
      try { if (v.length) localStorage.setItem(key, JSON.stringify(v)); else localStorage.removeItem(key); } catch { /* private mode */ }
    },
  };
}
