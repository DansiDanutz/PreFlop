import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { bookJson, buildBook, renderBookMarkdown } from '../src/book.ts';

export const BOOK_MD = fileURLToPath(new URL('../../../docs/odds-book.md', import.meta.url));
export const BOOK_JSON = fileURLToPath(new URL('../../../docs/odds-book.json', import.meta.url));

const book = buildBook();
writeFileSync(BOOK_MD, renderBookMarkdown(book));
writeFileSync(BOOK_JSON, bookJson(book));
console.log(`wrote ${BOOK_MD} and ${BOOK_JSON}`);
