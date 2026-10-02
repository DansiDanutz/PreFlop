import { migrate } from '@preflop/db';
import { buildApp } from './app.ts';
import { loadConfigOrExit } from './config.ts';
import { createPool } from './lib/db.ts';
import { startWebhookFanout } from './routes/partner.ts';
import { startWorker } from './worker.ts';

const config = loadConfigOrExit();
const db = createPool(config.databaseUrl);
const applied = await migrate(db);
if (applied.length) console.log(`migrations applied: ${applied.join(', ')}`);
const app = await buildApp(db, config);
const stopFanout = startWebhookFanout(db);
const stop = config.runWorker ? startWorker(db, { resultSlaMs: config.resultSlaMs, reviewSlaMs: config.reviewSlaMs, maxCaptureDelayMs: config.maxCaptureDelayMs }) : () => {};
await app.listen({ port: config.port, host: '0.0.0.0' });
console.log(`PreFlop API on :${config.port}`);
const shutdown = async () => {
  stop();
  stopFanout();
  await app.close();
  await db.end();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
