import { ROLE_LABEL, type TabletConfig } from './keystore.ts';
import type { WhoAmI } from './types.ts';

/**
 * Compares GET /v1/provider/whoami with this tablet's setup. Returns a message for the first
 * mismatch, or null when the credential is a staff credential for the same table, role and person.
 */
export function enrollmentMismatch(c: Pick<TabletConfig, 'tableId' | 'role' | 'personId'>, who: WhoAmI): string | null {
  if (who.kind !== 'staff') return 'This credential belongs to a device (Table Box), not to a person. Ask the club admin for your staff credential.';
  if (who.table_id !== c.tableId) return `This credential is for table "${who.table_id}", but this tablet is set up for "${c.tableId}". Reset the tablet or ask the club admin.`;
  if (who.role !== c.role) return `This credential is for the role ${who.role ? ROLE_LABEL[who.role] : 'unknown'}, but this tablet is set up as ${ROLE_LABEL[c.role]}. Reset the tablet and choose the right role, or ask the club admin.`;
  if ((who.person_id ?? '').trim() !== c.personId.trim()) return `This credential belongs to "${who.person_id}", not "${c.personId}". Each person needs their own credential.`;
  return null;
}
