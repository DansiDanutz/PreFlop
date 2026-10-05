import type { Plugin } from 'vite';
/** The commit the site is built from: VITE_BUILD_COMMIT, VERCEL_GIT_COMMIT_SHA, GITHUB_SHA or "dev". */
export declare const buildCommit: () => string;
/** Injects <meta name="build-commit" content="<sha>"> into index.html. */
export declare function buildCommitPlugin(): Plugin;
