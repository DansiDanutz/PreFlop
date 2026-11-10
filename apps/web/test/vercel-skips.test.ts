import { describe, expect, it } from 'vitest';
import { MAX_SKIPPED_COMMITS, skippedByVercel, vercelProjectOf, vercelSkippedEvery } from '../../../deploy/vercel-skips.mjs';

const PROJECT = 'preflop-staging-table';
const skipped = { context: `Vercel – ${PROJECT}`, state: 'success', description: 'Skipped - Not affected' };
const built = { context: `Vercel – ${PROJECT}`, state: 'success', description: 'Deployment has completed' };
const pending = { context: `Vercel – ${PROJECT}`, state: 'pending', description: 'Vercel is deploying your app' };
const otherSkipped = { context: 'Vercel – preflop-staging-web', state: 'success', description: 'Skipped - Not affected' };

/** A fetch that serves commit statuses from a map of sha → statuses (newest first, as GitHub does). */
const statusesFetch = (bySha: Record<string, unknown>, calls: string[] = []) => async (url: string | URL, init?: RequestInit) => {
  calls.push(`${String(url)} ${JSON.stringify(init?.headers ?? {})}`);
  const sha = /commits\/([0-9a-f]+)\/statuses/.exec(String(url))?.[1] ?? '';
  const body = bySha[sha];
  return new Response(JSON.stringify(body ?? { message: 'Not Found' }), { status: body ? 200 : 404 });
};

describe('vercelProjectOf', () => {
  it('reads the project name from a vercel.app site URL', () => {
    expect(vercelProjectOf('https://preflop-staging-table.vercel.app')).toBe(PROJECT);
  });

  it('returns null for a site that is not on vercel.app or is not a URL', () => {
    expect(vercelProjectOf('https://table.example.com')).toBeNull();
    expect(vercelProjectOf('not a url')).toBeNull();
  });
});

describe('skippedByVercel', () => {
  it('is true when the newest status of that project says the build was skipped', () => {
    expect(skippedByVercel([otherSkipped, skipped], PROJECT)).toBe(true);
  });

  it('is false when the project was built, is still building, or has no status', () => {
    expect(skippedByVercel([built], PROJECT)).toBe(false);
    expect(skippedByVercel([pending, skipped], PROJECT)).toBe(false);
    expect(skippedByVercel([otherSkipped], PROJECT)).toBe(false);
    expect(skippedByVercel('unexpected', PROJECT)).toBe(false);
  });
});

describe('vercelSkippedEvery', () => {
  const repo = 'owner/name';

  it('is true when Vercel skipped the project on every commit', async () => {
    const fetchImpl = statusesFetch({ aaa1: [skipped], bbb2: [skipped, pending] });
    expect(await vercelSkippedEvery(['aaa1', 'bbb2'], PROJECT, { repo, fetchImpl })).toBe(true);
  });

  it('is false when any commit in between was built for the project', async () => {
    const fetchImpl = statusesFetch({ aaa1: [skipped], bbb2: [built] });
    expect(await vercelSkippedEvery(['aaa1', 'bbb2'], PROJECT, { repo, fetchImpl })).toBe(false);
  });

  it('is false when GitHub does not answer for a commit', async () => {
    const fetchImpl = statusesFetch({ aaa1: [skipped] });
    expect(await vercelSkippedEvery(['aaa1', 'ccc3'], PROJECT, { repo, fetchImpl })).toBe(false);
  });

  it('is false without commits, a project or a repository, and beyond the commit limit', async () => {
    const fetchImpl = statusesFetch({ aaa1: [skipped] });
    const tooMany = Array.from({ length: MAX_SKIPPED_COMMITS + 1 }, () => 'aaa1');
    expect(await vercelSkippedEvery([], PROJECT, { repo, fetchImpl })).toBe(false);
    expect(await vercelSkippedEvery(['aaa1'], null, { repo, fetchImpl })).toBe(false);
    expect(await vercelSkippedEvery(['aaa1'], PROJECT, { repo: '', fetchImpl })).toBe(false);
    expect(await vercelSkippedEvery(tooMany, PROJECT, { repo, fetchImpl })).toBe(false);
  });

  it('sends the token as a bearer header only when one is given', async () => {
    const calls: string[] = [];
    const fetchImpl = statusesFetch({ aaa1: [skipped] }, calls);
    await vercelSkippedEvery(['aaa1'], PROJECT, { repo, token: 'test-token', fetchImpl });
    await vercelSkippedEvery(['aaa1'], PROJECT, { repo, fetchImpl });
    expect(calls[0]).toContain('https://api.github.com/repos/owner/name/commits/aaa1/statuses');
    expect(calls[0]).toContain('Bearer test-token');
    expect(calls[1]).not.toContain('authorization');
  });
});
