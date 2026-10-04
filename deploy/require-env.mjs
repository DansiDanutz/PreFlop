// @ts-check
/**
 * Deployable builds must know where the API is. The apps fall back to http://localhost:4000 for
 * local development; a production bundle with that fallback would talk to the visitor's own
 * machine. So a production build without VITE_API_URL fails loudly instead. Vercel and the Docker
 * image set it (the Dockerfile has an ARG default for the local compose stack); for a local
 * production build pass it explicitly, e.g. VITE_API_URL=http://localhost:4000 pnpm build.
 */

/**
 * Every deployable build needs it, whatever its mode name (`--mode staging` ships just the same).
 * Only an explicit development build (`vite build --mode development`, never deployed) may use the
 * fallback.
 * @param {string} mode
 * @param {Record<string, string | undefined>} env
 * @param {readonly string[]} [names]
 * @returns {string[]} the missing variable names (empty for a development build)
 */
export function missingBuildEnv(mode, env, names = ['VITE_API_URL']) {
  if (mode === 'development') return [];
  return names.filter((n) => !env[n] || !String(env[n]).trim());
}

/**
 * Vite plugin: fails `vite build` (any mode but development) when a required variable is missing.
 * @param {readonly string[]} [names]
 * @returns {import('vite').Plugin}
 */
export function requireBuildEnv(names = ['VITE_API_URL']) {
  return {
    name: 'preflop-require-build-env',
    apply: 'build',
    configResolved(config) {
      const missing = missingBuildEnv(config.mode, { ...config.env, ...process.env }, names);
      if (missing.length) {
        throw new Error(`${missing.join(', ')} must be set for a deployable build (the localhost fallback is for development only). `
          + `Example: ${missing.map((n) => `${n}=https://${n === 'VITE_API_URL' ? 'api' : 'www'}.example.com`).join(' ')} pnpm build`);
      }
    },
  };
}
