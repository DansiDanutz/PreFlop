import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MARKETS, SELECTIONS } from '../src/markets.ts';
import { MAX_FAIR_ODDS } from '../src/pricing.ts';
import { statsFor } from '../src/probability.ts';

/** docs/03-market-rules.md is the player rulebook: every market must have a written rule there. */
const rulebook = readFileSync(new URL('../../../docs/03-market-rules.md', import.meta.url), 'utf8');
const rulesTable = rulebook.slice(rulebook.indexOf('### 4.2'), rulebook.indexOf('## 5.'));
const lines = rulebook.split('\n');

/** Market ids named in the first column of the §4.2 table; `suit-count-s`, `-h` expands to suit-count-h. */
function documentedIds(): Set<string> {
  const ids = new Set<string>();
  for (const line of rulesTable.split('\n')) {
    let base = '';
    for (const [, id] of (line.split('|')[1] ?? '').matchAll(/`([^`]+)`/g)) {
      if (id!.startsWith('-') && base) ids.add(base.replace(/-[^-]+$/, '') + id);
      else ids.add((base = id!));
    }
  }
  return ids;
}

describe('rulebook (docs/03)', () => {
  it('has a rule row for every market id in the catalogue', () => {
    expect(rulesTable.length).toBeGreaterThan(0);
    const documented = documentedIds();
    for (const m of MARKETS) expect(documented.has(m.id), `${m.id} missing from docs/03 §4.2`).toBe(true);
  });

  it('lists every market id in the catalogue table', () => {
    for (const m of MARKETS) {
      const id = m.id.startsWith('suit-count-') ? 'suit-count-{s,h,d,c}' : m.id;
      expect(rulebook, `${m.id} missing from docs/03 §4 table`).toContain(`\`${id}\``);
    }
  });

  it('states the right market and selection counts', () => {
    const offered = SELECTIONS.filter((s) => 22100 / statsFor(s).wins <= MAX_FAIR_ODDS).length;
    expect(rulebook).toContain(`**${MARKETS.length} markets** with **${SELECTIONS.length} selections** (${offered} offered;`);
  });

  it('names every first-release market', () => {
    const line = lines.find((l) => l.startsWith('**First release**')) ?? '';
    for (const m of MARKETS.filter((x) => x.firstRelease)) expect(line, m.id).toContain(`\`${m.id}\``);
  });

  it('documents every hand-class selection with its exact count', () => {
    const hc = MARKETS.find((m) => m.id === 'hand-class')!;
    for (const s of hc.selections) {
      const row = lines.find((l) => l.startsWith(`| \`${s.id}\` |`));
      expect(row, `${s.id} missing from docs/03 §4.1`).toBeDefined();
      expect(row!.split('|')[3]!.trim().replace(/,/g, ''), s.id).toBe(String(statsFor(s).wins));
    }
  });
});
