/**
 * Whether Vercel itself decided a site did not need rebuilding for a commit.
 *
 * Vercel builds each site separately and skips a site whose inputs did not change; it reports that
 * on the commit as a status "Vercel – <project>" with the description "Skipped - Not affected".
 * Vercel's notion of "inputs" is finer than a path rule can be (it reads the lockfile per project),
 * so the smoke test asks for that status instead of guessing (scripts/staging-smoke.mjs).
 */
const GITHUB_API = 'https://api.github.com';
const REQUEST_TIMEOUT_MS = 20_000;
/** Above this many commits between the served build and the deployed one, do not ask at all. */
export const MAX_SKIPPED_COMMITS = 20;

/** The Vercel project a site URL belongs to (preflop-staging-table.vercel.app → preflop-staging-table). */
export function vercelProjectOf(siteUrl) {
  try {
    const host = new URL(siteUrl).hostname;
    return host.endsWith('.vercel.app') ? host.slice(0, -'.vercel.app'.length) : null;
  } catch {
    return null;
  }
}

/** Whether the newest status of that project (GitHub lists newest first) says the build was skipped. */
export function skippedByVercel(statuses, project) {
  if (!Array.isArray(statuses)) return false;
  const latest = statuses.find((s) => s?.context === `Vercel – ${project}`);
  return latest?.state === 'success' && /^skipped\b/i.test(latest.description ?? '');
}

/** Whether Vercel skipped the project on every one of the commits. Anything unknown is "no". */
export async function vercelSkippedEvery(commits, project, { repo, token, fetchImpl = fetch } = {}) {
  if (!project || !repo || commits.length === 0 || commits.length > MAX_SKIPPED_COMMITS) return false;
  const headers = { accept: 'application/vnd.github+json', ...(token ? { authorization: `Bearer ${token}` } : {}) };
  for (const sha of commits) {
    const res = await fetchImpl(`${GITHUB_API}/repos/${repo}/commits/${sha}/statuses?per_page=100`, { headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!res.ok || !skippedByVercel(await res.json(), project)) return false;
  }
  return true;
}
