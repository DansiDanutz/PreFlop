import { migrate } from '@preflop/db';
import { loadConfig } from './config.ts';
import { createPool } from './lib/db.ts';
import { startWorker } from './worker.ts';

/**
 * Standalone worker: outbox jobs, deadline sweeper and webhook delivery. Run it when the API is
 * started with RUN_WORKER=false. Several workers may run: jobs are taken with SKIP LOCKED and
 * every job is idempotent. (Webhook fan-out listens to in-process events, so it stays with the API.)
 */
const config = loadConfig();
const db = createPool(config.databaseUrl, 5);
await migrate(db);
const stop = startWorker(db, { resultSlaMs: config.resultSlaMs, reviewSlaMs: config.reviewSlaMs, maxCaptureDelayMs: config.maxCaptureDelayMs });
console.log('PreFlop worker running');
const shutdown = async () => {
  stop();
  await db.end();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
