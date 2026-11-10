#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
/**
 * Clears what an interrupted blue-green deploy left behind, before the next deploy runs
 * (.github/workflows/deploy-staging.yml): node deploy/fly-recover.mjs <app>
 *
 * A blue-green deploy starts new machines, moves traffic to them, then destroys the old ones. When
 * Fly's API fails between those steps the app keeps machines of two images, and every later deploy
 * is refused with "found multiple image versions" until someone removes one side by hand. This
 * does that, and only when it is clear which side serves:
 *
 *   - the newest release's machines are all started, taking traffic and passing their checks:
 *     the switch finished, so the older machines are destroyed;
 *   - the newest release's machines never took traffic (all cordoned) and the previous release's
 *     are all serving and healthy: the switch never happened, so the new ones are destroyed.
 *
 * Anything else (half switched, unhealthy, unknown) is left alone and the step fails with what it
 * saw, so a person decides. Exit code 0 when there was nothing to do or the leftovers are gone.
 */

const releaseOf = (m) => {
  const v = Number(m?.config?.metadata?.fly_release_version);
  return Number.isInteger(v) && v > 0 ? v : null;
};
const serving = (m) => m.state === 'started' && m.cordoned === false && Array.isArray(m.checks) && m.checks.length > 0 && m.checks.every((c) => c.status === 'passing');

/** Decides what to do with an app's machines: nothing, destroy one side, or ask a person. Pure. */
export function planRecovery(machines) {
  const images = new Set(machines.map((m) => m?.image_ref?.tag ?? null));
  if (images.size <= 1) return { action: 'none' };
  if (machines.some((m) => releaseOf(m) === null)) return { action: 'manual', reason: 'a machine does not say which release it belongs to' };
  const releases = [...new Set(machines.map(releaseOf))].sort((a, b) => b - a);
  const of = (release) => machines.filter((m) => releaseOf(m) === release);
  const [newest, previous] = releases;
  const others = (keep) => machines.filter((m) => releaseOf(m) !== keep).map((m) => m.id);
  if (of(newest).every(serving)) return { action: 'destroy', ids: others(newest), keepRelease: newest, reason: `release ${newest} is serving and healthy; older machines are leftovers` };
  if (releases.length === 2 && of(newest).every((m) => m.cordoned === true) && of(previous).every(serving)) {
    return { action: 'destroy', ids: others(previous), keepRelease: previous, reason: `release ${newest} never took traffic; release ${previous} still serves` };
  }
  return { action: 'manual', reason: `releases ${releases.join(', ')} are present and it is not clear which one serves` };
}

const describe = (m) => `${m.id} release ${releaseOf(m) ?? '?'} ${m.state}${m.cordoned ? ' cordoned' : ''} checks ${(m.checks ?? []).map((c) => c.status).join('/') || 'none'}`;

function main(app) {
  if (!app) {
    console.error('usage: node deploy/fly-recover.mjs <app>');
    process.exit(2);
  }
  const fly = (...args) => execFileSync('flyctl', args, { stdio: ['ignore', 'pipe', 'inherit'], timeout: 120_000 }).toString();
  const machines = JSON.parse(fly('machines', 'list', '--app', app, '--json'));
  const plan = planRecovery(machines);
  if (plan.action === 'none') {
    console.log(`${app}: one image version, nothing to clear`);
    return;
  }
  console.log(`${app}: machines of more than one image version:`);
  for (const m of machines) console.log(`  ${describe(m)}`);
  if (plan.action === 'manual') {
    console.error(`::error::${app}: ${plan.reason}. Nothing was changed; look at the machines above and remove the stale ones (docs/18-staging.md).`);
    process.exit(1);
  }
  console.log(`${app}: ${plan.reason}; destroying ${plan.ids.join(', ')}`);
  fly('machines', 'destroy', ...plan.ids, '--force', '--app', app);
  const after = planRecovery(JSON.parse(fly('machines', 'list', '--app', app, '--json')));
  if (after.action !== 'none') {
    console.error(`::error::${app}: machines of more than one image version are still there after the cleanup`);
    process.exit(1);
  }
  console.log(`${app}: cleared`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv[2]);
