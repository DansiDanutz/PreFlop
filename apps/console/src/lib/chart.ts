/** Tiny chart math for the hand-rolled SVG charts. */

export type Scale = ((v: number) => number) & { domain: [number, number]; range: [number, number] };

export function scaleLinear(domain: [number, number], range: [number, number]): Scale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0;
  const f = ((v: number) => (span === 0 ? (r0 + r1) / 2 : r0 + ((v - d0) / span) * (r1 - r0))) as Scale;
  f.domain = domain;
  f.range = range;
  return f;
}

/** A "nice" step (1, 2, 2.5 or 5 × 10^k) for roughly `count` intervals. */
export function niceStep(span: number, count: number): number {
  if (!(span > 0) || count < 1) return 1;
  const raw = span / count;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const m = raw / pow;
  const nice = m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10;
  return nice * pow;
}

/** Domain widened to nice bounds plus its ticks. Always includes 0 when `zero` (bars and money). */
export function niceDomain(values: readonly number[], count = 4, zero = true): { domain: [number, number]; ticks: number[] } {
  const finite = values.filter(Number.isFinite);
  let lo = finite.length ? Math.min(...finite) : 0;
  let hi = finite.length ? Math.max(...finite) : 0;
  if (zero) { lo = Math.min(0, lo); hi = Math.max(0, hi); }
  if (lo === hi) { hi = lo === 0 ? 1 : lo + Math.abs(lo); if (!zero) lo = lo - Math.abs(lo) / 2; }
  const step = niceStep(hi - lo, count);
  const d0 = Math.floor(lo / step) * step;
  const d1 = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  for (let t = d0; t <= d1 + step / 2; t += step) ticks.push(Number(t.toPrecision(12)));
  return { domain: [d0, d1], ticks };
}

/** SVG path through points; gaps (null) break the line. */
export function linePath(points: readonly ({ x: number; y: number } | null)[]): string {
  let d = '';
  let pen = false;
  for (const p of points) {
    if (!p) { pen = false; continue; }
    d += `${pen ? 'L' : 'M'}${round(p.x)},${round(p.y)}`;
    pen = true;
  }
  return d;
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Compact axis labels: 1200 → "1.2k", 3_400_000 → "3.4M". */
export function compact(n: number): string {
  const a = Math.abs(n);
  const f = (v: number, s: string) => `${Number(v.toFixed(v < 10 ? 1 : 0))}${s}`;
  if (a >= 1e9) return (n < 0 ? '-' : '') + f(a / 1e9, 'B');
  if (a >= 1e6) return (n < 0 ? '-' : '') + f(a / 1e6, 'M');
  if (a >= 1e3) return (n < 0 ? '-' : '') + f(a / 1e3, 'k');
  return String(Number(n.toFixed(2)));
}

/** Index of the nearest x position (for the hover crosshair). */
export function nearestIndex(xs: readonly number[], x: number): number {
  let best = 0;
  let bd = Infinity;
  xs.forEach((v, i) => { const d = Math.abs(v - x); if (d < bd) { bd = d; best = i; } });
  return best;
}
