import { migrate } from '@preflop/db';
import { loadConfigOrExit } from './config.ts';
import { createPool } from './lib/db.ts';
import { deciderFromConfig } from './lib/decisions.ts';
import { startGrowthWorker } from './growth/worker.ts';
import { mailTransportFor, mailWarning } from './lib/mailer.ts';
import { startWorker } from './worker.ts';

/**
 * Standalone worker: outbox jobs, deadline sweeper and webhook delivery. Run it when the API is
 * started with RUN_WORKER=false. Several workers may run: jobs are taken with SKIP LOCKED and
 * every job is idempotent. Webhook deliveries are queued inside the settlement/void transactions
 * (lib/webhooks.ts), so whichever process settles a round also queues its webhooks.
 */
const config = loadConfigOrExit();
const mailProblem = mailWarning(config);
if (mailProblem) console.warn(`warning: ${mailProblem}`);
const decider = deciderFromConfig(config);
console.log(decider.enabled ? `decision hints: ${decider.model} (docs/20)` : 'decision hints: off (set JEV_API_KEY to turn them on)');
const db = createPool(config.databaseUrl, 5);
await migrate(db);
const stop = startWorker(db, { resultSlaMs: config.resultSlaMs, reviewSlaMs: config.reviewSlaMs, maxCaptureDelayMs: config.maxCaptureDelayMs }, 1000, { transport: mailTransportFor(config), from: config.mail.from }, 5000, decider);
const stopGrowth = startGrowthWorker(db);
console.log('PreFlop worker running');
const shutdown = async () => {
  stopGrowth();
  await stop();
  await db.end();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
