import { migrate } from '@preflop/db';
import { buildApp } from './app.ts';
import { loadConfigOrExit } from './config.ts';
import { startGrowthWorker } from './growth/worker.ts';
import { createPool } from './lib/db.ts';
import { startWorker } from './worker.ts';

const config = loadConfigOrExit();
const db = createPool(config.databaseUrl);
const applied = await migrate(db);
if (applied.length) console.log(`migrations applied: ${applied.join(', ')}`);
const app = await buildApp(db, config);
const stop = config.runWorker ? startWorker(db, { resultSlaMs: config.resultSlaMs, reviewSlaMs: config.reviewSlaMs, maxCaptureDelayMs: config.maxCaptureDelayMs }) : async () => {};
const stopGrowth = config.runWorker ? startGrowthWorker(db) : () => {};
await app.listen({ port: config.port, host: '0.0.0.0' });
console.log(`PreFlop API on :${config.port}`);
const shutdown = async () => {
  stopGrowth();
  await stop();
  await app.close();
  await db.end();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
