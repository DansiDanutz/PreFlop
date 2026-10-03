import type { OrgRole } from '@preflop/client';

/** What the signed-in member may do to one member row (the API enforces the same rules). */
export interface MemberActions { roles: OrgRole[]; canChange: boolean; canRemove: boolean; note: string | null }

/**
 * Owners manage everyone; admins manage admins and viewers but never owners and never make anyone
 * an owner; viewers are read-only. The last owner can be neither demoted nor removed.
 */
export function memberActions(target: { role: OrgRole }, me: { role: string; write: boolean }, ownerCount: number): MemberActions {
  const none = (note: string | null): MemberActions => ({ roles: [target.role], canChange: false, canRemove: false, note });
  if (!me.write) return none(null);
  const owner = me.role === 'owner';
  if (target.role === 'owner') {
    if (!owner) return none('Only an owner can change an owner');
    if (ownerCount <= 1) return none('The last owner stays: add another owner first');
  }
  const roles: OrgRole[] = owner ? ['owner', 'admin', 'viewer'] : ['admin', 'viewer'];
  return { roles: roles.includes(target.role) ? roles : [target.role, ...roles], canChange: true, canRemove: true, note: null };
}
