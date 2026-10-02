import pg from 'pg';
import { migrate } from './index.ts';

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? 'postgres://postgres@localhost:5432/preflop' });
const applied = await migrate(pool);
console.log(applied.length ? `applied: ${applied.join(', ')}` : 'up to date');
await pool.end();
