import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { bookJson, buildBook, renderBookMarkdown } from '../src/book.ts';
import { evaluateAll, renderProfitabilityMarkdown } from '../src/scenarios.ts';

export const BOOK_MD = fileURLToPath(new URL('../../../docs/odds-book.md', import.meta.url));
export const PROFIT_MD = fileURLToPath(new URL('../../../docs/profitability.md', import.meta.url));
export const BOOK_JSON = fileURLToPath(new URL('../../../docs/odds-book.json', import.meta.url));

const book = buildBook();
writeFileSync(BOOK_MD, renderBookMarkdown(book));
writeFileSync(BOOK_JSON, bookJson(book));
writeFileSync(PROFIT_MD, renderProfitabilityMarkdown(evaluateAll()));
console.log(`wrote ${BOOK_MD}, ${BOOK_JSON} and ${PROFIT_MD}`);
