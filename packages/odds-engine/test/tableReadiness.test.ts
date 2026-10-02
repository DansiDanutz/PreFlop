import { describe, expect, it } from 'vitest';
import { CUT_DEPTH, canOpenRound, checkLink, drawCutDepth, handProcedureProblems, streamPrivacyDecision } from '../src/tableReadiness.ts';

const good = { uploadMbps: 25, rttMs: 40, jitterMs: 5, packetLossPct: 0.1, videoDelayMs: 1500, heartbeatAgeS: 1, backupLinkUp: true, streamLive: true };
const cert = { shufflerPaired: true, connectionTestPassed: true, camerasApproved: true, dealersTrained: true,
  shufflerSealsVerifiedThisShift: true, boardCameraCalibrated: true, tableBoxAttested: true, upsOk: true, privacyMasksVerified: true };

describe('connection health', () => {
  it('healthy link opens rounds', () => {
    expect(checkLink(good).status).toBe('healthy');
    expect(canOpenRound(cert, good).ok).toBe(true);
  });
  it('slow or lossy link is degraded and blocks new rounds', () => {
    expect(checkLink({ ...good, videoDelayMs: 4000 }).status).toBe('degraded');
    expect(checkLink({ ...good, packetLossPct: 3 }).status).toBe('degraded');
    expect(canOpenRound(cert, { ...good, backupLinkUp: false }).ok).toBe(false);
  });
  it('no live stream means no betting (live streaming is mandatory)', () => {
    expect(checkLink({ ...good, streamLive: false }).status).toBe('down');
    expect(canOpenRound(cert, { ...good, streamLive: false }).ok).toBe(false);
  });
  it('lost heartbeat or a far-behind stream is down', () => {
    expect(checkLink({ ...good, heartbeatAgeS: 12 }).status).toBe('down');
    expect(checkLink({ ...good, videoDelayMs: 9000 }).status).toBe('down');
  });
  it('an uncertified table never opens, however good the link', () => {
    expect(canOpenRound({ ...cert, shufflerPaired: false }, good).problems).toContain('automatic shuffler not paired');
  });
});

describe('per-hand procedure: shuffle → lock → random cut → cut → deal-start', () => {
  const ok = { shuffleCompleteAt: 1, shuffleSource: 'shuffler' as const, lockedAt: 2, cutInstructionAt: 3, cutAt: 4, dealStartAt: 5 };
  it('accepts the correct order', () => {
    expect(handProcedureProblems(ok)).toEqual([]);
  });
  it('voids hands with a missing step, a manual shuffle, or steps out of order', () => {
    const { cutAt: _omit, ...noCut } = ok;
    expect(handProcedureProblems(noCut)).toContain('no cut recorded');
    expect(handProcedureProblems({ ...ok, shuffleSource: 'manual' })).toEqual(['shuffle not reported by the automatic shuffler']);
    expect(handProcedureProblems({ ...ok, cutInstructionAt: 1.5 })).toContain('cut instruction happened before lock');
    expect(handProcedureProblems({ ...ok, dealStartAt: 3.5 })).toContain('deal-start happened before cut');
  });
  it('an unsealed shuffler blocks the table', () => {
    expect(canOpenRound({ ...cert, shufflerSealsVerifiedThisShift: false }, good).ok).toBe(false);
  });
  it('draws cut depths uniformly inside the allowed range', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 5000; i++) {
      const d = drawCutDepth();
      expect(d).toBeGreaterThanOrEqual(CUT_DEPTH.min);
      expect(d).toBeLessThanOrEqual(CUT_DEPTH.max);
      seen.add(d);
    }
    expect(seen.size).toBe(CUT_DEPTH.max - CUT_DEPTH.min + 1);
  });
});

describe('stream privacy: dealer, shuffler and cards only — never the players', () => {
  it('streams the normal program when nobody is visible outside the dealer zone', () => {
    expect(streamPrivacyDecision({ personsOutsideDealerZone: 0, framingDrift: false })).toEqual({ view: 'program', alert: false });
  });
  it('cuts to the board-only view and alerts when a player appears or a camera moves', () => {
    expect(streamPrivacyDecision({ personsOutsideDealerZone: 1, framingDrift: false }).view).toBe('board-only');
    expect(streamPrivacyDecision({ personsOutsideDealerZone: 0, framingDrift: true }).alert).toBe(true);
  });
  it('a table without verified privacy masks cannot open', () => {
    expect(canOpenRound({ ...cert, privacyMasksVerified: false }, good).problems).toContain('stream privacy masks not verified');
  });
  it('needs enough upload for all three feeds', () => {
    expect(checkLink({ ...good, uploadMbps: 15 }).status).toBe('degraded');
  });
});
