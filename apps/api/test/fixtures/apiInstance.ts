import { buildApp } from '../../src/app.ts';
import { loadConfig } from '../../src/config.ts';
import { createPool } from '../../src/lib/db.ts';
import { startEventRelay } from '../../src/lib/events.ts';

/**
 * One API instance in its own process (test fixture for multi-instance tests): its own module
 * state (keyed mutex, caches), sharing only the database, with the cross-instance event relay on
 * as in main.ts. Prints "READY <port>" once listening.
 */
const base = loadConfig({ DATABASE_URL: process.env.DATABASE_URL });
const db = createPool(base.databaseUrl, 10);
const stopRelay = await startEventRelay(db);
const app = await buildApp(db, { ...base, runWorker: false, rateLimit: { ...base.rateLimit, enabled: false } });
await app.listen({ port: 0, host: '127.0.0.1' });
const addr = app.server.address();
console.log(`READY ${typeof addr === 'object' && addr ? addr.port : 0}`);
const stop = async () => {
  await stopRelay();
  await app.close();
  await db.end();
  process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
