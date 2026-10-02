export interface Config {
  databaseUrl: string;
  port: number;
  /** Rounds still LOCKED or DEALT this long after the lock are voided and refunded. */
  resultSlaMs: number;
  /** A REVIEW decision must be made within this time, otherwise the round voids. */
  reviewSlaMs: number;
  /** Largest gap between deal-start and the capture. */
  maxCaptureDelayMs: number;
  /** Run the outbox worker and sweeper inside the API process. */
  runWorker: boolean;
  /** Starting balance of a play-money wallet (and the reset target). */
  playStartMinor: number;
  corsOrigins: string[];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    databaseUrl: env.DATABASE_URL ?? 'postgres://postgres@localhost:5432/preflop',
    port: Number(env.PORT ?? 4000),
    resultSlaMs: Number(env.RESULT_SLA_MS ?? 5 * 60_000),
    reviewSlaMs: Number(env.REVIEW_SLA_MS ?? 30 * 60_000),
    maxCaptureDelayMs: Number(env.MAX_CAPTURE_DELAY_MS ?? 180_000),
    runWorker: (env.RUN_WORKER ?? 'true') !== 'false',
    playStartMinor: Number(env.PLAY_START ?? 10_000),
    corsOrigins: (env.CORS_ORIGINS ?? '*').split(',').map((s) => s.trim()),
  };
}
