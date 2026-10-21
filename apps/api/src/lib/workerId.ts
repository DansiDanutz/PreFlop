import { hostname } from 'node:os';

/**
 * The start of every worker id this process creates (worker.ts newWorkerId): host and pid. Readiness
 * uses it to look only at this process's own worker, so during a blue-green deploy a new machine
 * whose worker never started is not reported ready on the old machine's heartbeat.
 */
export const localWorkerPrefix = () => `${hostname()}:${process.pid}:`;
