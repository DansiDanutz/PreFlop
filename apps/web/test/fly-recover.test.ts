import { describe, expect, it } from 'vitest';
import { planRecovery } from '../../../deploy/fly-recover.mjs';

/** A machine as `flyctl machines list --json` prints it, reduced to what the plan reads. */
const machine = (id: string, release: number, o: { state?: string; cordoned?: boolean; checks?: string[] } = {}) => ({
  id,
  state: o.state ?? 'started',
  cordoned: o.cordoned ?? false,
  image_ref: { tag: `deployment-${release}` },
  config: { metadata: { fly_release_version: String(release) } },
  checks: (o.checks ?? ['passing']).map((status) => ({ name: 'http', status })),
});

describe('planRecovery', () => {
  it('does nothing when every machine runs the same image', () => {
    expect(planRecovery([machine('a', 43), machine('b', 43)])).toEqual({ action: 'none' });
    expect(planRecovery([])).toEqual({ action: 'none' });
  });

  it('removes the old machines when the new ones are serving and healthy (the switch finished, the teardown did not)', () => {
    const plan = planRecovery([machine('new1', 43), machine('new2', 43), machine('old1', 42, { cordoned: true }), machine('old2', 42, { cordoned: true })]);
    expect(plan).toMatchObject({ action: 'destroy', ids: ['old1', 'old2'], keepRelease: 43 });
  });

  it('removes the new machines when they never took traffic and the old ones still serve (the switch did not happen)', () => {
    const plan = planRecovery([machine('new1', 43, { cordoned: true }), machine('old1', 42), machine('old2', 42)]);
    expect(plan).toMatchObject({ action: 'destroy', ids: ['new1'], keepRelease: 42 });
  });

  it('touches nothing when neither side is clearly the one serving', () => {
    const halfSwitched = planRecovery([machine('new1', 43), machine('new2', 43, { cordoned: true }), machine('old1', 42)]);
    expect(halfSwitched.action).toBe('manual');
    const newUnhealthy = planRecovery([machine('new1', 43, { checks: ['critical'] }), machine('old1', 42, { cordoned: true })]);
    expect(newUnhealthy.action).toBe('manual');
    const stopped = planRecovery([machine('new1', 43, { state: 'stopped' }), machine('old1', 42, { cordoned: true })]);
    expect(stopped.action).toBe('manual');
    const noChecks = planRecovery([machine('new1', 43, { checks: [] }), machine('old1', 42, { cordoned: true })]);
    expect(noChecks.action).toBe('manual');
  });

  it('touches nothing when a machine does not say which release it belongs to', () => {
    const odd = { ...machine('x', 43), config: { metadata: {} } };
    expect(planRecovery([odd, machine('old1', 42)]).action).toBe('manual');
  });

  it('handles more than two releases: only the newest, healthy one stays', () => {
    const plan = planRecovery([machine('n', 44), machine('m', 43, { cordoned: true }), machine('o', 42, { cordoned: true })]);
    expect(plan).toMatchObject({ action: 'destroy', ids: ['m', 'o'], keepRelease: 44 });
  });
});
