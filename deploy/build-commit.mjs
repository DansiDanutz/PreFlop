/**
 * The commit a site was built from, as <meta name="build-commit" content="<sha>"> in index.html.
 * Vercel sets VERCEL_GIT_COMMIT_SHA at build time and CI sets GITHUB_SHA; a local build says "dev".
 * The staging smoke test (scripts/staging-smoke.mjs) reads it, so a deploy passes only once each
 * site serves the build of the commit that was just deployed, not an older one still being replaced.
 */
export const buildCommit = () => process.env.VITE_BUILD_COMMIT ?? process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? 'dev';

export function buildCommitPlugin() {
  return {
    name: 'preflop-build-commit',
    transformIndexHtml: () => [{ tag: 'meta', attrs: { name: 'build-commit', content: buildCommit() }, injectTo: 'head' }],
  };
}
