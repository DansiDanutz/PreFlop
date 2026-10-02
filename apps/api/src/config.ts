import { z } from 'zod';

export interface Config {
  /** development | test | production. Production turns on the safety checks below. */
  nodeEnv: 'development' | 'test' | 'production';
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
  /** Trust X-Forwarded-For from the load balancer (per-IP rate limits need the client address). */
  trustProxy: boolean;
  /** Fastify request logging (LOG=1). */
  log: boolean;
}

/** Thrown when the environment is invalid; `problems` lists every reason, one per line. */
export class ConfigError extends Error {
  constructor(readonly problems: string[], nodeEnv: string) {
    super(`invalid configuration (NODE_ENV=${nodeEnv}):\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'ConfigError';
  }
}

const MIN_SECRET_LENGTH = 32;
const MIN_ADMIN_PASSWORD_LENGTH = 12;

/**
 * Values that ship in examples, docs, tests or demo scripts. A secret equal to one of these (any
 * case), or containing one of the placeholder words, is refused in production.
 */
export const DEMO_SECRETS = new Set([
  'postgres', 'password', 'preflop', 'secret', 'changeme', 'change-me', 'change_me', 'admin', 'test', 'demo', 'example',
  'admin-pass-1', 'correct horse', 'letmein', 'qwerty', '123456', '12345678', 'password123', 'preflop-dev', 'dev',
]);
const PLACEHOLDER_WORDS = ['changeme', 'change-me', 'change_me', 'replace-me', 'replaceme', 'example', 'your-secret', 'xxxxxxxx'];
const WEAK_PASSWORD_WORDS = ['password', 'preflop', 'admin', 'changeme', 'qwerty', 'letmein', '123456'];

const isDemoSecret = (v: string) => {
  const l = v.toLowerCase();
  return DEMO_SECRETS.has(l) || PLACEHOLDER_WORDS.some((w) => l.includes(w));
};

/** Why a human password (ADMIN_PASSWORD) is weak, or null when it is acceptable. */
export function passwordWeakness(pw: string): string | null {
  if (pw.length < MIN_ADMIN_PASSWORD_LENGTH) return `is shorter than ${MIN_ADMIN_PASSWORD_LENGTH} characters`;
  if (isDemoSecret(pw)) return 'is a known demo/default value';
  const l = pw.toLowerCase();
  const word = WEAK_PASSWORD_WORDS.find((w) => l.includes(w));
  if (word) return `contains the common word "${word}"`;
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  if (classes < 3) return 'needs at least 3 of: lowercase, uppercase, digits, symbols';
  return null;
}

const bool = (def: boolean) => z.enum(['true', 'false', '1', '0']).default(def ? 'true' : 'false').transform((v) => v === 'true' || v === '1');
const ms = (def: number) => z.coerce.number().int().positive().default(def);

/** The environment variables the API and worker read. Unknown variables are ignored. */
const Env = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url().default('postgres://postgres@localhost:5432/preflop'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  RESULT_SLA_MS: ms(5 * 60_000),
  REVIEW_SLA_MS: ms(30 * 60_000),
  MAX_CAPTURE_DELAY_MS: ms(180_000),
  RUN_WORKER: bool(true),
  PLAY_START: z.coerce.number().int().nonnegative().default(10_000),
  CORS_ORIGINS: z.string().default('*'),
  TRUST_PROXY: bool(false),
  LOG: bool(false),
  WEBHOOK_ALLOW_PRIVATE: bool(false),
  ADMIN_PASSWORD: z.string().optional(),
});
type Env = z.infer<typeof Env>;

/**
 * Secrets read from the environment, checked in production (≥ 32 characters, not a demo value).
 * Add a line here for every new secret. Today the only server-side secret is the database
 * password; partner client secrets and webhook secrets are generated and stored in the database.
 */
const SECRETS: { name: string; get: (e: Env) => string | undefined }[] = [
  { name: 'DATABASE_URL password', get: (e) => { try { return decodeURIComponent(new URL(e.DATABASE_URL).password) || undefined; } catch { return undefined; } } },
];

/** Production-only refusals. Returns every problem found (empty = OK). */
export function productionProblems(raw: NodeJS.ProcessEnv, e: Env): string[] {
  const problems: string[] = [];
  const cors = (raw.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (cors.length === 0) problems.push('CORS_ORIGINS must list the allowed origins (comma-separated); it is empty');
  else if (cors.includes('*')) problems.push('CORS_ORIGINS must not be "*" in production; list the web, console and table origins');
  if (!raw.DATABASE_URL) problems.push('DATABASE_URL must be set in production (the localhost default is for development)');
  for (const s of SECRETS) {
    const v = s.get(e);
    if (v === undefined) continue;
    if (isDemoSecret(v)) problems.push(`${s.name} is a known demo/default value; generate a random one (e.g. openssl rand -base64 48)`);
    else if (v.length < MIN_SECRET_LENGTH) problems.push(`${s.name} is ${v.length} characters; secrets must be at least ${MIN_SECRET_LENGTH}`);
  }
  if (e.ADMIN_PASSWORD !== undefined) {
    const why = passwordWeakness(e.ADMIN_PASSWORD);
    if (why) problems.push(`ADMIN_PASSWORD ${why}`);
  }
  if (e.WEBHOOK_ALLOW_PRIVATE) problems.push('WEBHOOK_ALLOW_PRIVATE=true is for local tests only; it lets webhooks reach private addresses (SSRF)');
  return problems;
}

/**
 * Parses and validates the environment. Throws ConfigError listing every problem: malformed
 * values in any environment, and in production also unsafe settings (see productionProblems).
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // An empty variable (FOO=) means "not set", except for the production checks on the raw values.
  const present = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== ''));
  const nodeEnv = String(present.NODE_ENV ?? 'development');
  const parsed = Env.safeParse(present);
  if (!parsed.success) throw new ConfigError(parsed.error.issues.map((i) => `${i.path.join('.') || 'env'}: ${i.message}`), nodeEnv);
  const e = parsed.data;
  if (e.NODE_ENV === 'production') {
    const problems = productionProblems(env, e);
    if (problems.length) throw new ConfigError(problems, e.NODE_ENV);
  }
  return {
    nodeEnv: e.NODE_ENV,
    databaseUrl: e.DATABASE_URL,
    port: e.PORT,
    resultSlaMs: e.RESULT_SLA_MS,
    reviewSlaMs: e.REVIEW_SLA_MS,
    maxCaptureDelayMs: e.MAX_CAPTURE_DELAY_MS,
    runWorker: e.RUN_WORKER,
    playStartMinor: e.PLAY_START,
    corsOrigins: e.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
    trustProxy: e.TRUST_PROXY,
    log: e.LOG,
  };
}

/** loadConfig() for process entry points: prints the problems and exits instead of a stack trace. */
export function loadConfigOrExit(env: NodeJS.ProcessEnv = process.env): Config {
  try {
    return loadConfig(env);
  } catch (e) {
    if (e instanceof ConfigError) {
      console.error(`PreFlop refused to start: ${e.message}`);
      process.exit(1);
    }
    throw e;
  }
}
