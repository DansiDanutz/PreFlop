import { describe, expect, it } from 'vitest';
import { CONSOLE_REVOKE_PATH, type RetiredCredential, type RetiredStore, confirmRevoked, retireCredential, revokeInstruction } from '../src/lib/handover.ts';
import type { TabletConfig } from '../src/lib/keystore.ts';

const mem = (): RetiredStore & { v: RetiredCredential[] } => {
  const s = { v: [] as RetiredCredential[], get: () => s.v, set: (v: RetiredCredential[]) => { s.v = v; } };
  return s;
};
const cfg = (extra: Partial<TabletConfig> = {}): TabletConfig => ({
  apiUrl: 'https://api.test', tableId: 'atlas-t04', personId: 'Ana · D-117', role: 'dealer', credentialId: 'cred-8f2a', publicKeyPem: '', fingerprint: 'a1b2c3d4e5f60718', createdAt: 0, ...extra,
});

describe('retired credentials (reset / re-enroll)', () => {
  it('remembers the credential a reset retires, with who it signed as', () => {
    const s = mem();
    retireCredential(cfg(), s, 1000);
    expect(s.v).toEqual([{ credentialId: 'cred-8f2a', role: 'dealer', personId: 'Ana · D-117', tableId: 'atlas-t04', fingerprint: 'a1b2c3d4e5f60718', retiredAt: 1000 }]);
  });
  it('keeps one entry per credential, and several different ones', () => {
    const s = mem();
    retireCredential(cfg(), s);
    retireCredential(cfg(), s);
    retireCredential(cfg({ credentialId: 'cred-99', fingerprint: 'ffff' }), s);
    expect(s.v.map((x) => x.credentialId)).toEqual(['cred-8f2a', 'cred-99']);
  });
  it('forgets one only when the revoke is confirmed', () => {
    const s = mem();
    retireCredential(cfg(), s);
    retireCredential(cfg({ credentialId: 'cred-99', fingerprint: 'ffff' }), s);
    expect(confirmRevoked({ credentialId: 'cred-8f2a', fingerprint: 'a1b2c3d4e5f60718' }, s).map((x) => x.credentialId)).toEqual(['cred-99']);
  });
  it('tells the club admin which credential to revoke and where', () => {
    const s = mem();
    const [r] = retireCredential(cfg(), s);
    const text = revokeInstruction(r!);
    expect(text).toContain('cred-8f2a');
    expect(text).toContain('Dealer · Ana · D-117 · table atlas-t04');
    expect(text).toContain(CONSOLE_REVOKE_PATH);
    expect(CONSOLE_REVOKE_PATH).toBe('Club console → Staff & devices → Staff credentials → Revoke');
  });
  it('a key reset before verification is identified by its fingerprint', () => {
    const s = mem();
    const { credentialId: _c, ...unverified } = cfg();
    const [r] = retireCredential(unverified, s);
    expect(r!.credentialId).toBeNull();
    expect(revokeInstruction(r!)).toMatch(/fingerprint a1b2c3d4e5f60718/);
  });
});
