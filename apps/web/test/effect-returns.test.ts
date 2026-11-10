import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * An effect written as `useEffect(() => someBrowserCall())` returns whatever that call returns, and
 * React calls a non-undefined return as the cleanup. `window.scrollTo` used to return undefined;
 * current Chrome returns a Promise, so the first route change after such an effect threw "is not a
 * function" and blanked the whole app. An effect that calls a browser API must use a block body.
 */
const APPS = fileURLToPath(new URL('../..', import.meta.url));
const ROOTS = ['web/src', 'console/src', 'table/src'].map((p) => join(APPS, p));
const BROWSER_CALL = /use(?:Layout|Insertion)?Effect\(\s*\(\)\s*=>\s*(?:window|document|navigator|history|location|\w+\.current)\b[^;{]*\(/;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return sources(path);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [path] : [];
  });
}

describe('effects', () => {
  it('never return the result of a browser API call as their cleanup', () => {
    const offenders = ROOTS.flatMap(sources).flatMap((file) =>
      readFileSync(file, 'utf8').split('\n').flatMap((line, i) => (BROWSER_CALL.test(line) ? [`${file.slice(APPS.length)}:${i + 1} ${line.trim()}`] : [])));
    expect(offenders).toEqual([]);
  });

  it('the rule recognises the pattern that broke navigation and accepts the block form', () => {
    expect(BROWSER_CALL.test('  useEffect(() => window.scrollTo(0, 0), [pathname]);')).toBe(true);
    expect(BROWSER_CALL.test('  useEffect(() => ref.current?.focus(), []);')).toBe(true);
    expect(BROWSER_CALL.test('  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);')).toBe(false);
    expect(BROWSER_CALL.test('  useEffect(() => setOpen(false), [loc.pathname]);')).toBe(false);
  });
});
