import { describe, expect, it } from 'vitest';
import { canOpenRound, checkLink, handProcedureProblems } from '../src/tableReadiness.ts';

const good = { uploadMbps: 25, rttMs: 40, jitterMs: 5, packetLossPct: 0.1, videoDelayMs: 1500, heartbeatAgeS: 1, backupLinkUp: true };
const cert = { shufflerPaired: true, connectionTestPassed: true, camerasApproved: true, dealersTrained: true };

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
  it('lost heartbeat or a far-behind stream is down', () => {
    expect(checkLink({ ...good, heartbeatAgeS: 12 }).status).toBe('down');
    expect(checkLink({ ...good, videoDelayMs: 9000 }).status).toBe('down');
  });
  it('an uncertified table never opens, however good the link', () => {
    expect(canOpenRound({ ...cert, shufflerPaired: false }, good).problems).toContain('automatic shuffler not paired');
  });
});

describe('per-hand procedure: shuffler → cut → deal-start', () => {
  it('accepts the correct order', () => {
    expect(handProcedureProblems({ shuffleCompleteAt: 1, shuffleSource: 'shuffler', cutAt: 2, dealStartAt: 3 })).toEqual([]);
  });
  it('voids hands with a missing cut, a manual shuffle, or events out of order', () => {
    expect(handProcedureProblems({ shuffleCompleteAt: 1, shuffleSource: 'shuffler', dealStartAt: 3 })).toContain('no cut recorded');
    expect(handProcedureProblems({ shuffleCompleteAt: 1, shuffleSource: 'manual', cutAt: 2, dealStartAt: 3 })).toHaveLength(1);
    expect(handProcedureProblems({ shuffleCompleteAt: 5, shuffleSource: 'shuffler', cutAt: 2, dealStartAt: 6 })).toContain('cut recorded before the shuffle completed');
    expect(handProcedureProblems({ shuffleCompleteAt: 1, shuffleSource: 'shuffler', cutAt: 4, dealStartAt: 3 })).toContain('deal started before the cut');
  });
});
