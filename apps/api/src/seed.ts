import { type KeyObject, generateKeyPairSync } from 'node:crypto';
import { hashPassword } from './auth/players.ts';
import type { Tx } from './lib/db.ts';
import { CERT_FLAGS } from './rounds/readiness.ts';

export interface Keypair { privateKey: KeyObject; publicPem: string; privatePem: string }
export function keypair(): Keypair {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return { privateKey, publicPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(), privatePem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() };
}

export function fullCertification(by: string, days = 3650): Record<string, { ok: boolean; by: string; at: string; expires_at: string }> {
  const at = new Date().toISOString();
  const expires_at = new Date(Date.now() + days * 86_400_000).toISOString();
  return Object.fromEntries(CERT_FLAGS.map((k) => [k, { ok: true, by, at, expires_at }]));
}

export async function upsertClub(c: Tx, id: string, name: string, settings: Record<string, unknown> = {}): Promise<void> {
  await c.query('insert into clubs (id, name) values ($1, $2) on conflict (id) do update set name = excluded.name', [id, name]);
  await c.query(`insert into organizations (id, kind, name, settings) values ($1, 'club', $2, $3)
                 on conflict (id) do update set name = excluded.name, settings = excluded.settings`, [id, name, JSON.stringify(settings)]);
}

export interface SimTableKeys {
  tableId: string;
  deviceId: string;
  device: Keypair;
  shuffler: Keypair;
  staff: { dealer: { id: string; key: Keypair }; floor: { id: string; key: Keypair }; floor_manager: { id: string; key: Keypair } };
}

/**
 * Creates (or re-keys) a SIMULATED table with its Table Box, Trusted Shuffler key and three staff
 * credentials held by three different people. Simulated tables are the only ones allowed to run
 * while physical-table play is disabled.
 */
export async function seedSimTable(c: Tx, o: { clubId: string; tableId: string; name: string; mode?: string; currency?: string; maxRoundLossMinor?: number }): Promise<SimTableKeys> {
  const device = keypair(), shuffler = keypair();
  const deviceId = `box-${o.tableId}`;
  await c.query(
    `insert into poker_tables (id, club_id, name, mode, currency, kind, certification, max_round_loss_minor)
     values ($1, $2, $3, $4, $5, 'simulated', $6, $7)
     on conflict (id) do update set certification = excluded.certification, status = 'active', pause_reason = null`,
    [o.tableId, o.clubId, o.name, o.mode ?? 'play', o.currency ?? 'PLAY', JSON.stringify(fullCertification('system:seed')), o.maxRoundLossMinor ?? 5_000_000]);
  await c.query(
    `insert into devices (id, table_id, public_key_pem, shuffler_public_key_pem) values ($1, $2, $3, $4)
     on conflict (id) do update set public_key_pem = excluded.public_key_pem, shuffler_public_key_pem = excluded.shuffler_public_key_pem, revoked = false`,
    [deviceId, o.tableId, device.publicPem, shuffler.publicPem]);
  const staff = {} as SimTableKeys['staff'];
  for (const role of ['dealer', 'floor', 'floor_manager'] as const) {
    const key = keypair();
    const id = `cred-${o.tableId}-${role}`;
    await c.query(
      `insert into staff_credentials (id, table_id, person_id, role, public_key_pem) values ($1, $2, $3, $4, $5)
       on conflict (id) do update set public_key_pem = excluded.public_key_pem, revoked = false`,
      [id, o.tableId, `sim-${role}-${o.tableId}`, role, key.publicPem]);
    staff[role] = { id, key };
  }
  return { tableId: o.tableId, deviceId, device, shuffler, staff };
}

export async function seedAdmin(c: Tx, email: string, password: string): Promise<string> {
  const id = 'u_admin';
  await c.query(
    `insert into users (id, email, password_hash, display_name, platform_role, kyc_status) values ($1, $2, $3, 'PreFlop Admin', 'admin', 'verified')
     on conflict (id) do update set email = excluded.email, password_hash = excluded.password_hash`, [id, email, await hashPassword(password)]);
  return id;
}
