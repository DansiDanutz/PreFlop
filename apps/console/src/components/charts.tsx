import { useId, useMemo, useState } from 'react';
import { compact, linePath, nearestIndex, niceDomain, scaleLinear } from '../lib/chart.ts';

/** Categorical series palette, validated against the dark surface #121514 (dataviz validator: lightness band, CVD ΔE ≥ 20). */
export const SERIES = ['#0fa66a', '#3f8ef0', '#c27a0e'] as const;

export interface Series { name: string; values: (number | null)[]; color?: string }

const M = { top: 12, right: 16, bottom: 26, left: 52 };

/** Multi-series line chart with one y axis, recessive grid, legend, and crosshair + tooltip on hover/focus. */
export function LineChart({ labels, series, height = 240, format = compact, ariaLabel }: {
  labels: string[]; series: Series[]; height?: number; format?: (v: number) => string; ariaLabel: string;
}) {
  const width = 760;
  const [hover, setHover] = useState<number | null>(null);
  const clip = useId();
  const all = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const { domain, ticks } = useMemo(() => niceDomain(all, 4), [all.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const x = scaleLinear([0, Math.max(1, labels.length - 1)], [M.left, width - M.right]);
  const y = scaleLinear(domain, [height - M.bottom, M.top]);
  const xs = labels.map((_, i) => x(i));
  const labelEvery = Math.max(1, Math.ceil(labels.length / 8));

  const move = (clientX: number, el: SVGSVGElement) => {
    const r = el.getBoundingClientRect();
    setHover(nearestIndex(xs, ((clientX - r.left) / r.width) * width));
  };

  return (
    <figure className="m-0">
      {series.length > 1 && (
        <figcaption className="mb-3 flex flex-wrap gap-4 text-xs text-muted">
          {series.map((s, i) => (
            <span key={s.name} className="inline-flex items-center gap-2"><span className="h-0.5 w-4 rounded" style={{ background: s.color ?? SERIES[i] }} />{s.name}</span>
          ))}
        </figcaption>
      )}
      <div className="relative">
        <svg viewBox={`0 0 ${width} ${height}`} className="block h-auto w-full touch-none" role="img" aria-label={ariaLabel} tabIndex={0}
          onMouseMove={(e) => move(e.clientX, e.currentTarget)} onMouseLeave={() => setHover(null)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') setHover((h) => Math.min(labels.length - 1, (h ?? -1) + 1));
            if (e.key === 'ArrowLeft') setHover((h) => Math.max(0, (h ?? labels.length) - 1));
            if (e.key === 'Escape') setHover(null);
          }}
          onBlur={() => setHover(null)}>
          <defs><clipPath id={clip}><rect x={M.left} y={0} width={width - M.left - M.right} height={height} /></clipPath></defs>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} stroke="var(--color-line)" strokeWidth={t === 0 ? 1.2 : 1} strokeDasharray={t === 0 ? undefined : '2 4'} />
              <text x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize="11" fill="var(--color-faint)">{format(t)}</text>
            </g>
          ))}
          {labels.map((l, i) => (i % labelEvery === 0 || i === labels.length - 1) && (
            <text key={i} x={xs[i]} y={height - 6} textAnchor="middle" fontSize="11" fill="var(--color-faint)">{l}</text>
          ))}
          <g clipPath={`url(#${clip})`}>
            {series.map((s, si) => (
              <path key={s.name} d={linePath(s.values.map((v, i) => (v === null ? null : { x: xs[i]!, y: y(v) })))}
                fill="none" stroke={s.color ?? SERIES[si]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            ))}
          </g>
          {hover !== null && (
            <g>
              <line x1={xs[hover]} x2={xs[hover]} y1={M.top} y2={height - M.bottom} stroke="var(--color-line-strong)" />
              {series.map((s, si) => {
                const v = s.values[hover];
                return v === null || v === undefined ? null : <circle key={s.name} cx={xs[hover]} cy={y(v)} r={4.5} fill={s.color ?? SERIES[si]} stroke="var(--color-surface)" strokeWidth={2} />;
              })}
            </g>
          )}
        </svg>
        {hover !== null && (
          <div className="pointer-events-none absolute top-1 rounded-[10px] border border-line-strong bg-surface-2/95 px-3 py-2 text-xs shadow-lg"
            style={{ left: `${(xs[hover]! / width) * 100}%`, transform: `translateX(${xs[hover]! / width > 0.6 ? 'calc(-100% - 10px)' : '10px'})` }}>
            <div className="mb-1 font-semibold text-ink">{labels[hover]}</div>
            {series.map((s, si) => (
              <div key={s.name} className="flex items-center gap-2 text-muted">
                <span className="h-2 w-2 rounded-full" style={{ background: s.color ?? SERIES[si] }} />{s.name}
                <span className="ml-auto pl-3 tabular-nums text-ink">{s.values[hover] === null || s.values[hover] === undefined ? '—' : format(s.values[hover]!)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </figure>
  );
}

/** Vertical bar chart for one measure across categories (negative values hang below the zero line). */
export function BarChart({ data, height = 220, format = compact, ariaLabel, color = SERIES[0] }: {
  data: { label: string; value: number; color?: string }[]; height?: number; format?: (v: number) => string; ariaLabel: string; color?: string;
}) {
  const width = 760;
  const [hover, setHover] = useState<number | null>(null);
  const { domain, ticks } = niceDomain(data.map((d) => d.value), 4);
  const y = scaleLinear(domain, [height - M.bottom, M.top]);
  const band = (width - M.left - M.right) / Math.max(1, data.length);
  const bw = Math.min(56, band * 0.56);
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${width} ${height}`} className="block h-auto w-full" role="img" aria-label={ariaLabel}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} stroke="var(--color-line)" strokeDasharray={t === 0 ? undefined : '2 4'} />
            <text x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize="11" fill="var(--color-faint)">{format(t)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = M.left + band * i + band / 2;
          const y0 = y(0);
          const y1 = y(d.value);
          const h = Math.max(1, Math.abs(y1 - y0));
          const top = Math.min(y0, y1);
          const r = Math.min(4, h / 2, bw / 2);
          // Rounded only at the data end; flat on the baseline.
          const path = d.value >= 0
            ? `M${cx - bw / 2},${y0}V${top + r}Q${cx - bw / 2},${top} ${cx - bw / 2 + r},${top}H${cx + bw / 2 - r}Q${cx + bw / 2},${top} ${cx + bw / 2},${top + r}V${y0}Z`
            : `M${cx - bw / 2},${y0}V${top + h - r}Q${cx - bw / 2},${top + h} ${cx - bw / 2 + r},${top + h}H${cx + bw / 2 - r}Q${cx + bw / 2},${top + h} ${cx + bw / 2},${top + h - r}V${y0}Z`;
          return (
            <g key={d.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)} tabIndex={0} aria-label={`${d.label}: ${format(d.value)}`}>
              <rect x={cx - band / 2} y={M.top} width={band} height={height - M.top - M.bottom} fill="transparent" />
              <path d={path} fill={d.color ?? color} opacity={hover === null || hover === i ? 1 : 0.55} />
              <text x={cx} y={height - 6} textAnchor="middle" fontSize="11" fill="var(--color-faint)">{d.label}</text>
            </g>
          );
        })}
      </svg>
      {hover !== null && data[hover] && (
        <div className="pointer-events-none absolute top-1 rounded-[10px] border border-line-strong bg-surface-2/95 px-3 py-2 text-xs shadow-lg"
          style={{ left: `${((M.left + band * hover + band / 2) / width) * 100}%`, transform: 'translateX(-50%)' }}>
          <span className="text-muted">{data[hover].label}</span> <span className="ml-2 tabular-nums text-ink">{format(data[hover].value)}</span>
        </div>
      )}
    </div>
  );
}

/** Inline trend glyph (no axes); the adjacent text carries the value. */
export function Sparkline({ values, width = 96, height = 28, color = SERIES[0], label }: { values: number[]; width?: number; height?: number; color?: string; label: string }) {
  if (values.length < 2) return null;
  const { domain } = niceDomain(values, 2, false);
  const x = scaleLinear([0, values.length - 1], [2, width - 2]);
  const y = scaleLinear(domain, [height - 3, 3]);
  const d = linePath(values.map((v, i) => ({ x: x(i), y: y(v) })));
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label}>
      <path d={d} fill="none" stroke={color} strokeWidth={1.75} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(values.length - 1)} cy={y(values[values.length - 1]!)} r={2.5} fill={color} />
    </svg>
  );
}

/** Horizontal meter: used vs limit (risk exposure, collateral reserved). */
export function Meter({ value, max, label, warnAt = 0.75 }: { value: number; max: number; label: string; warnAt?: number }) {
  const f = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const tone = f >= 1 ? 'var(--color-danger)' : f >= warnAt ? 'var(--color-warn)' : 'var(--color-accent)';
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-surface-3" role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={value}>
      <div className="h-full rounded-full transition-[width]" style={{ width: `${f * 100}%`, background: tone }} />
    </div>
  );
}
