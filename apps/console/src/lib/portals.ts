import type { Me, OrgKind } from '@preflop/client';

export type PortalKind = 'admin' | OrgKind | 'agent';

export interface Portal {
  /** Stable key, also the URL prefix: "/admin" or "/club/<orgId>". */
  key: string;
  kind: PortalKind;
  orgId: string | null;
  name: string;
  role: string;
  /** False when the membership is not active (e.g. a suspended org): listed but not enterable. */
  enabled: boolean;
  status: string;
}

export const KIND_LABEL: Record<PortalKind, string> = {
  admin: 'PreFlop team',
  club: 'Poker club',
  partner: 'Betting partner',
  organizer: 'Organizer',
  agent: 'Agent',
};

const KIND_ORDER: Record<PortalKind, number> = { admin: 0, club: 1, partner: 2, organizer: 3, agent: 4 };

export const portalPath = (kind: PortalKind, orgId: string | null) =>
  kind === 'admin' ? '/admin' : kind === 'agent' ? '/agent' : `/${kind}/${encodeURIComponent(orgId ?? '')}`;

/** Every portal the signed-in user may open, built from GET /v1/me. PreFlop team first, then clubs, partners, organizers (by name). */
export function resolvePortals(me: Pick<Me, 'platform_role' | 'memberships'> & Partial<Pick<Me, 'agent'>>): Portal[] {
  const out: Portal[] = [];
  if (me.platform_role) {
    out.push({ key: '/admin', kind: 'admin', orgId: null, name: 'PreFlop team', role: me.platform_role, enabled: true, status: 'active' });
  }
  const seen = new Set<string>();
  for (const m of me.memberships ?? []) {
    if (!(m.kind in KIND_ORDER) || m.kind === ('admin' as string)) continue;
    const key = portalPath(m.kind, m.org_id);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, kind: m.kind, orgId: m.org_id, name: m.name, role: m.role, enabled: m.status === 'active', status: m.status });
  }
  // An approved agent gets the agent portal: referral link, players, sub-agents, statements.
  if (me.agent && (me.agent.status === 'active' || me.agent.status === 'suspended')) {
    out.push({ key: '/agent', kind: 'agent', orgId: null, name: `Agent ${me.agent.code}`, role: 'agent', enabled: me.agent.status === 'active', status: me.agent.status });
  }
  return out.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.name.localeCompare(b.name));
}

/** Which portal to land on after login: the remembered one if still valid, else the only one, else none (show the switcher). */
export function pickLandingPortal(portals: Portal[], remembered: string | null | undefined): Portal | null {
  const usable = portals.filter((p) => p.enabled);
  if (remembered) {
    const hit = usable.find((p) => p.key === remembered);
    if (hit) return hit;
  }
  return usable.length === 1 ? usable[0]! : null;
}

/** The portal a pathname belongs to ("/club/abc/tables" → the club abc portal), or null. */
export function portalForPath(portals: Portal[], pathname: string): Portal | null {
  const m = /^\/(admin|agent)(?:\/|$)|^\/(club|partner|organizer)\/([^/]+)/.exec(pathname);
  if (!m) return null;
  const key = m[1] ? `/${m[1]}` : `/${m[2]}/${m[3]}`;
  return portals.find((p) => p.key === key) ?? null;
}

/** Org roles that may change things; viewers are read-only. */
export const canWrite = (p: Portal | null) => !!p && p.enabled && p.role !== 'viewer';
