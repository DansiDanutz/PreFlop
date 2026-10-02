import { createHash, randomBytes } from 'node:crypto';
import { audit } from './audit.ts';
import type { Tx } from './db.ts';
import { conflict, notFound } from './errors.ts';

/**
 * Organization ownership is handed over with a single-use claim link (never by matching an
 * unverified email). The token is shown once to the PreFlop team; only its hash is stored.
 */
export const CLAIM_TTL_MS = 14 * 86_400_000;

const hash = (token: string) => createHash('sha256').update(token).digest('hex');

export interface OwnerClaim { token: string; expires_at: string }

/** Issues a fresh claim for an organization, revoking any earlier unclaimed ones. */
export async function issueOwnerClaim(c: Tx, orgId: string, email: string | null, by: string, now = new Date()): Promise<OwnerClaim> {
  // One issuer at a time per organization, so a replacement always revokes every earlier link.
  await c.query('select 1 from organizations where id = $1 for update', [orgId]);
  await c.query('update org_owner_claims set revoked_at = now() where org_id = $1 and claimed_at is null and revoked_at is null', [orgId]);
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(now.getTime() + CLAIM_TTL_MS);
  await c.query('insert into org_owner_claims (token_hash, org_id, email, created_by, expires_at) values ($1, $2, $3, $4, $5)',
    [hash(token), orgId, email, by, expires]);
  await audit(c, { type: 'org.owner_claim_issued', orgId, by });
  return { token, expires_at: expires.toISOString() };
}

/** Redeems a claim: the signed-in user becomes an owner of the organization. */
export async function redeemOwnerClaim(c: Tx, token: string, userId: string): Promise<{ org_id: string; kind: string }> {
  const row = (await c.query<{ org_id: string; kind: string; expires_at: Date; claimed_at: Date | null; revoked_at: Date | null }>(
    `select k.org_id, o.kind, k.expires_at, k.claimed_at, k.revoked_at from org_owner_claims k join organizations o on o.id = k.org_id
      where k.token_hash = $1 for update of k`, [hash(token)])).rows[0];
  if (!row) throw notFound('claim link');
  if (row.claimed_at || row.revoked_at) throw conflict('claim_used', 'this link has already been used or replaced; ask PreFlop for a new one');
  if (row.expires_at.getTime() <= Date.now()) throw conflict('claim_expired', 'this link has expired; ask PreFlop for a new one');
  await c.query(`insert into memberships (user_id, org_id, role) values ($1, $2, 'owner') on conflict (user_id, org_id) do update set role = 'owner'`, [userId, row.org_id]);
  await c.query('update org_owner_claims set claimed_by = $2, claimed_at = now() where token_hash = $1', [hash(token), userId]);
  await audit(c, { type: 'org.owner_claimed', orgId: row.org_id, userId });
  return { org_id: row.org_id, kind: row.kind };
}
