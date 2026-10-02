import { describe, expect, it } from 'vitest';
import type { CertItem, Me, Statement } from '@preflop/client';
import { canWrite, pickLandingPortal, portalForPath, resolvePortals } from './portals.ts';
import { groupByParty, isPeriod, linesSum, POLICIES, reconciles, recentPeriods, shiftPeriod, statementTotals, tierIndex } from './statements.ts';
import { csvCell, minorToDecimal, toCsv } from './csv.ts';
import { emptyRulesForm, looseRules, isEmail, isHttpsUrl, isPublicKeyPem, parseAmount, pctToBps, validateRulesForm } from './rules.ts';
import { certSummary, CERT_ITEMS } from './certification.ts';
import { compact, linePath, nearestIndex, niceDomain, niceStep, scaleLinear } from './chart.ts';

// Fixtures for unit tests only.
const me = (over: Partial<Me> = {}): Pick<Me, 'platform_role' | 'memberships'> => ({
  platform_role: null,
  memberships: [],
  ...over,
});

describe('portal resolution from /v1/me', () => {
  it('lists the PreFlop team first, then clubs, partners and organizers by name', () => {
    const p = resolvePortals(me({
      platform_role: 'ops',
      memberships: [
        { org_id: 'o2', kind: 'organizer', name: 'Zeta Nights', role: 'owner', status: 'active' },
        { org_id: 'p1', kind: 'partner', name: 'BetCo', role: 'admin', status: 'active' },
        { org_id: 'c2', kind: 'club', name: 'Meridian', role: 'viewer', status: 'active' },
        { org_id: 'c1', kind: 'club', name: 'Atlas', role: 'owner', status: 'active' },
      ],
    }));
    expect(p.map((x) => x.key)).toEqual(['/admin', '/club/c1', '/club/c2', '/partner/p1', '/organizer/o2']);
    expect(p[0]!.role).toBe('ops');
  });

  it('has no team portal for players without a platform role, and de-duplicates memberships', () => {
    const p = resolvePortals(me({ memberships: [
      { org_id: 'c1', kind: 'club', name: 'Atlas', role: 'owner', status: 'active' },
      { org_id: 'c1', kind: 'club', name: 'Atlas', role: 'owner', status: 'active' },
    ] }));
    expect(p).toHaveLength(1);
    expect(p[0]!.kind).toBe('club');
  });

  it('lands on the remembered portal, else the only one, else the switcher', () => {
    const p = resolvePortals(me({ platform_role: 'admin', memberships: [{ org_id: 'c1', kind: 'club', name: 'Atlas', role: 'owner', status: 'active' }] }));
    expect(pickLandingPortal(p, '/club/c1')?.key).toBe('/club/c1');
    expect(pickLandingPortal(p, '/club/gone')).toBeNull();
    expect(pickLandingPortal(p.slice(0, 1), null)?.key).toBe('/admin');
    const suspended = resolvePortals(me({ memberships: [{ org_id: 'c9', kind: 'club', name: 'X', role: 'owner', status: 'suspended' }] }));
    expect(suspended[0]!.enabled).toBe(false);
    expect(pickLandingPortal(suspended, '/club/c9')).toBeNull();
  });

  it('maps a pathname back to its portal and knows viewers are read-only', () => {
    const p = resolvePortals(me({ platform_role: 'admin', memberships: [{ org_id: 'p1', kind: 'partner', name: 'BetCo', role: 'viewer', status: 'active' }] }));
    expect(portalForPath(p, '/admin/settings')?.key).toBe('/admin');
    expect(portalForPath(p, '/partner/p1/webhooks')?.name).toBe('BetCo');
    expect(portalForPath(p, '/club/p1')).toBeNull();
    expect(portalForPath(p, '/login')).toBeNull();
    expect(canWrite(portalForPath(p, '/partner/p1'))).toBe(false);
    expect(canWrite(portalForPath(p, '/admin'))).toBe(true);
  });

  it('adds the agent portal last for an approved agent only', () => {
    const agent = (status: NonNullable<Me['agent']>['status']) =>
      resolvePortals({ ...me({ platform_role: 'ops' }), agent: { status, code: 'PFABC123' } });
    const p = agent('active');
    expect(p.map((x) => x.key)).toEqual(['/admin', '/agent']);
    expect(portalForPath(p, '/agent')?.name).toBe('Agent PFABC123');
    expect(portalForPath(p, '/agents')).toBeNull();
    expect(agent('suspended')[1]!.enabled).toBe(false);
    expect(agent('applied').map((x) => x.key)).toEqual(['/admin']);
  });
});

describe('statements', () => {
  const st = (party: string, currency: string, amounts: number[], total?: number): Statement => ({
    party, period: '2026-09', currency,
    lines: amounts.map((a, i) => ({ label: `l${i}`, amount_minor: a })),
    total_minor: total ?? amounts.reduce((a, b) => a + b, 0),
  });

  it('totals per currency without mixing currencies', () => {
    const t = statementTotals([st('club', 'EUR', [100, 250]), st('partner', 'EUR', [1000]), st('club', 'USDT', [5_000_000])]);
    expect(t).toEqual([
      { currency: 'EUR', total_minor: 1350, statements: 2 },
      { currency: 'USDT', total_minor: 5_000_000, statements: 1 },
    ]);
    expect(statementTotals([])).toEqual([]);
  });

  it('reconciles lines against the total and groups by party', () => {
    expect(linesSum(st('a', 'EUR', [1, 2, 3]))).toBe(6);
    expect(reconciles(st('a', 'EUR', [1, 2, 3]))).toBe(true);
    expect(reconciles(st('a', 'EUR', [1, 2, 3], 7))).toBe(false);
    const g = groupByParty([st('a', 'EUR', [1]), st('b', 'EUR', [1]), st('a', 'USDT', [1])]);
    expect(g.map((x) => [x.party, x.statements.length])).toEqual([['a', 2], ['b', 1]]);
  });

  it('handles YYYY-MM periods across year boundaries', () => {
    expect(isPeriod('2026-10')).toBe(true);
    expect(isPeriod('2026-13')).toBe(false);
    expect(shiftPeriod('2026-01', -1)).toBe('2025-12');
    expect(shiftPeriod('2025-12', 1)).toBe('2026-01');
    expect(recentPeriods('2026-02', 3)).toEqual(['2026-02', '2026-01', '2025-12']);
  });

  it('finds the tier a metric has reached on the docs/09 ladders', () => {
    const players = POLICIES.club.ladders[1]!;
    expect(tierIndex(players, 0)).toBe(0);
    expect(tierIndex(players, 100)).toBe(2);
    expect(players.tiers[tierIndex(players, 1000)]!.rate_bps).toBe(2000);
  });
});

describe('CSV export', () => {
  it('escapes quotes, commas and newlines', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(-12)).toBe('-12');
  });

  it('neutralises formula injection but keeps negative numbers', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('-12.50')).toBe('-12.50');
  });

  it('builds a header and rows with CRLF', () => {
    const csv = toCsv([{ id: 'b1', stake: 1050 }, { id: 'b,2', stake: 5 }], [
      { header: 'bet_id', value: (r) => r.id },
      { header: 'stake_eur', value: (r) => minorToDecimal(r.stake, 'EUR') },
    ]);
    expect(csv).toBe('bet_id,stake_eur\r\nb1,10.50\r\n"b,2",0.05\r\n');
  });

  it('converts minor units to decimals per currency', () => {
    expect(minorToDecimal(1050, 'EUR')).toBe('10.50');
    expect(minorToDecimal(-5, 'EUR')).toBe('-0.05');
    expect(minorToDecimal(1_500_000, 'USDT')).toBe('1.500000');
    expect(minorToDecimal(42, 'DIAMOND')).toBe('42');
  });
});

describe('room rules form validation', () => {
  it('accepts the defaults for a diamond organizer room', () => {
    const r = validateRulesForm({ ...emptyRulesForm('diamonds'), name: 'Friday', table_id: 'atlas-04' });
    expect(r.errors).toEqual({});
    expect(r.rules).toEqual({ margin_bps: 600, min_stake_minor: 20, rake_bps: 500, provider_share_bps: 1000 });
  });

  it('enforces the global minimum margin, diamond minimum stake and rake bounds', () => {
    const r = validateRulesForm({ ...emptyRulesForm('diamonds'), name: 'x', table_id: 't', margin_pct: '2', min_stake: '10', rake_pct: '16' });
    expect(r.rules).toBeNull();
    expect(r.errors.margin_pct).toMatch(/3%/);
    expect(r.errors.min_stake).toMatch(/20/);
    expect(r.errors.rake_pct).toMatch(/0% and 15%/);
  });

  it('requires name and table, and pool rooms use the pool rake band without a margin', () => {
    const r = validateRulesForm({ ...emptyRulesForm('virtual-chips'), house: 'pool', margin_pct: 'abc', rake_pct: '4' });
    expect(r.errors.name).toBeTruthy();
    expect(r.errors.table_id).toBeTruthy();
    expect(r.errors.margin_pct).toBeUndefined();
    expect(r.errors.rake_pct).toMatch(/5% and 20%/);
    const ok = validateRulesForm({ ...emptyRulesForm('virtual-chips'), name: 'Pool', table_id: 't', house: 'pool', rake_pct: '10', provider_share_pct: '' });
    expect(ok.rules).toEqual({ margin_bps: 0, min_stake_minor: 10, rake_bps: 1000 });
  });

  it('builds a loose payload for live server validation even when out of bounds', () => {
    const f = { ...emptyRulesForm('diamonds'), margin_pct: '2', min_stake: '10', rake_pct: '16' };
    expect(looseRules(f)).toEqual({ margin_bps: 200, min_stake_minor: 10, rake_bps: 1600, provider_share_bps: 1000 });
    expect(looseRules({ ...f, margin_pct: 'x' })).toBeNull();
    expect(looseRules({ ...emptyRulesForm('virtual-chips'), house: 'pool', margin_pct: 'ignored', rake_pct: '10', provider_share_pct: '' })).toEqual({ margin_bps: 0, min_stake_minor: 10, rake_bps: 1000 });
  });

  it('parses percents, amounts, emails, URLs and PEM keys', () => {
    expect(pctToBps('6.5')).toBe(650);
    expect(pctToBps('6.555')).toBeNull();
    expect(pctToBps('-1')).toBeNull();
    expect(parseAmount('12.34', 'EUR')).toBe(1234);
    expect(parseAmount('1,000', 'CHIP')).toBe(1000);
    expect(parseAmount('1.5', 'DIAMOND')).toBeNull();
    expect(parseAmount('0', 'EUR')).toBeNull();
    expect(parseAmount('2.5', 'USDT')).toBe(2_500_000);
    expect(isEmail('a@b.co')).toBe(true);
    expect(isEmail('a@b')).toBe(false);
    expect(isHttpsUrl('https://x.com/hook')).toBe(true);
    expect(isHttpsUrl('http://x.com/hook')).toBe(false);
    expect(isHttpsUrl('http://localhost:3000/h')).toBe(true);
    expect(isPublicKeyPem(`-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAGb9ECWmEzf6FQbrBZ9w7lshQhqowtrbLDFw4rXAxZuE=\n-----END PUBLIC KEY-----`)).toBe(true);
    expect(isPublicKeyPem('-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----')).toBe(false);
  });
});

describe('chart scaling', () => {
  it('maps a domain onto a range, including inverted SVG y ranges', () => {
    const y = scaleLinear([0, 100], [200, 0]);
    expect(y(0)).toBe(200);
    expect(y(50)).toBe(100);
    expect(y(100)).toBe(0);
    expect(scaleLinear([5, 5], [0, 10])(5)).toBe(5);
  });

  it('chooses nice steps and domains that include zero', () => {
    expect(niceStep(100, 4)).toBe(25);
    expect(niceStep(7, 4)).toBe(2);
    expect(niceDomain([3, 87])).toEqual({ domain: [0, 100], ticks: [0, 25, 50, 75, 100] });
    expect(niceDomain([-40, 90]).domain[0]).toBeLessThanOrEqual(-40);
    expect(niceDomain([]).domain).toEqual([0, 1]);
  });

  it('draws paths with gaps and finds the nearest point', () => {
    expect(linePath([{ x: 0, y: 1 }, { x: 1, y: 2 }, null, { x: 3, y: 4 }])).toBe('M0,1L1,2M3,4');
    expect(nearestIndex([0, 10, 20], 14)).toBe(1);
    expect(compact(1234)).toBe('1.2k');
    expect(compact(3_400_000)).toBe('3.4M');
    expect(compact(-25_000)).toBe('-25k');
  });
});

describe('certification summary', () => {
  it('counts only items that are ok and not expired, and flags those expiring soon', () => {
    const now = Date.parse('2026-10-02T00:00:00Z');
    const cert: Record<string, CertItem> = Object.fromEntries(CERT_ITEMS.map((i) => [i.key, { ok: true, expires_at: '2027-10-01T00:00:00Z' }]));
    expect(certSummary(cert, now)).toEqual({ ok: 9, total: 9, soon: 0, complete: true });
    cert.upsOk = { ok: true, expires_at: '2026-10-01T00:00:00Z' }; // expired
    cert.dealersTrained = { ok: true, expires_at: '2026-10-08T00:00:00Z' }; // 6 days left
    cert.camerasApproved = { ok: false };
    expect(certSummary(cert, now)).toEqual({ ok: 7, total: 9, soon: 1, complete: false });
    expect(certSummary(null, now).ok).toBe(0);
  });
});
