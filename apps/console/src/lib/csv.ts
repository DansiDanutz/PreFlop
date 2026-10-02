export interface CsvColumn<T> { header: string; value: (row: T) => string | number | boolean | null | undefined }

/** Escapes one CSV cell (RFC 4180) and neutralises spreadsheet formula injection for text cells. */
export function csvCell(v: string | number | boolean | null | undefined): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[]): string {
  const head = columns.map((c) => csvCell(c.header)).join(',');
  const body = rows.map((r) => columns.map((c) => csvCell(c.value(r))).join(','));
  return [head, ...body].join('\r\n') + '\r\n';
}

/** Minor units → plain decimal string for exports (no currency symbol, no grouping). */
export function minorToDecimal(minor: number, currency: string): string {
  const d = ({ EUR: 2, USDT: 6, USDC: 6, PLAY: 0, CHIP: 0, DIAMOND: 0 } as Record<string, number>)[currency] ?? 2;
  if (d === 0) return String(minor);
  const neg = minor < 0;
  const s = String(Math.abs(minor)).padStart(d + 1, '0');
  return `${neg ? '-' : ''}${s.slice(0, -d)}.${s.slice(-d)}`;
}

export function downloadText(filename: string, text: string, type = 'text/csv;charset=utf-8') {
  const url = URL.createObjectURL(new Blob(['﻿', text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
