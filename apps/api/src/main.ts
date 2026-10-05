import { migrate } from '@preflop/db';
import { buildApp } from './app.ts';
import { loadConfigOrExit } from './config.ts';
import { startGrowthWorker } from './growth/worker.ts';
import { createPool } from './lib/db.ts';
import { deciderFromConfig } from './lib/decisions.ts';
import { startEventRelay } from './lib/events.ts';
import { mailTransportFor, mailWarning } from './lib/mailer.ts';
import { startWorker } from './worker.ts';

const config = loadConfigOrExit();
const mailProblem = mailWarning(config);
if (mailProblem) console.warn(`warning: ${mailProblem}`);
const decider = deciderFromConfig(config);
console.log(decider.enabled ? `decision hints: ${decider.model} (docs/20)` : 'decision hints: off (set JEV_API_KEY to turn them on)');
const db = createPool(config.databaseUrl);
const applied = await migrate(db);
if (applied.length) console.log(`migrations applied: ${applied.join(', ')}`);
// Stream events cross API machines through PostgreSQL NOTIFY (lib/events.ts).
const stopRelay = await startEventRelay(db);
const app = await buildApp(db, config, { decider });
const stop = config.runWorker ? startWorker(db, { resultSlaMs: config.resultSlaMs, reviewSlaMs: config.reviewSlaMs, maxCaptureDelayMs: config.maxCaptureDelayMs }, 1000, { transport: mailTransportFor(config), from: config.mail.from }, 5000, decider) : async () => {};
const stopGrowth = config.runWorker ? startGrowthWorker(db) : () => {};
await app.listen({ port: config.port, host: '0.0.0.0' });
console.log(`PreFlop API on :${config.port}`);
const shutdown = async () => {
  stopGrowth();
  await stop();
  await stopRelay();
  await app.close();
  await db.end();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
