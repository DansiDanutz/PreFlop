import { isIP } from 'node:net';
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
  /** false, the number of proxy hops in front of the API, or the proxies' addresses/CIDRs (never a bare true in production). */
  trustProxy: boolean | number | string[];
  /** Fastify request logging (LOG=1). */
  log: boolean;
  /** In-process limits per window of one minute (per API instance). */
  rateLimit: RateLimitConfig;
  /** GET /v1/health/ready fails when the freshest worker heartbeat is older than this. */
  workerHeartbeatMaxAgeMs: number;
  /** Outgoing email (verification and password-reset links). See lib/mailer.ts. */
  mail: MailConfig;
  /** Decision model hints (docs/20): TypeSafe AI's Jev through JEV_API_KEY. Off without a key. */
  decisions: DecisionsConfig;
  /** Real-money provider adapters (docs/21): `sandbox` outside production, `none` (fail closed) by default in production. */
  providers: ProvidersConfig;
}

export type ProviderName = 'sandbox' | 'none';
export interface ProvidersConfig {
  /** KYC_PROVIDER: identity verification. */
  kyc: ProviderName;
  /** PSP_PROVIDER: fiat deposits and payouts (real-fiat). */
  psp: ProviderName;
  /** CUSTODY_PROVIDER: stablecoin deposits and payouts (real-crypto). */
  custody: ProviderName;
}

export interface DecisionsConfig {
  /** JEV_API_KEY, or null: every hint surface then says "off" and nothing else changes. */
  apiKey: string | null;
  /** JEV_API_URL: the System One endpoint. */
  url: string;
  /** JEV_MODEL, "jev-latest" by default. */
  model: string;
}

export interface MailConfig {
  /** Sender address (MAIL_FROM). */
  from: string;
  /** Base URL of the player web app; links in emails point here (WEB_URL). */
  webUrl: string;
  /**
   * SMTP_URL (smtp:// or smtps://, credentials in the URL), when set: lib/mailer.ts sends through
   * it with nodemailer. Without it, production keeps messages queued in email_outbox.
   */
  smtpUrl: string | null;
}

export interface RateLimitConfig {
  enabled: boolean;
  /** POST /v1/auth/login and /v1/auth/register, per client IP (each route counted separately). */
  authPerMinute: number;
  /** POST /v1/partner/oauth/token, per client IP. */
  partnerTokenPerMinute: number;
  /** POST /v1/bets, per signed-in user. */
  betsPerMinute: number;
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
/**
 * TRUST_PROXY: `false` (default), `true` (every X-Forwarded-For hop; refused in production, since
 * a client then forges its own address and every per-IP limit), a hop count (`1` behind Fly or one
 * load balancer: the last address a trusted proxy appended) or a comma-separated list of the
 * proxies' IPs/CIDRs (or proxy-addr's names loopback, linklocal, uniquelocal).
 */
const PROXY_ENTRY = /^([0-9a-fA-F:.]+)(\/\d{1,3})?$/;
export function parseTrustProxy(v: string): boolean | number | string[] {
  const s = v.trim();
  if (s === 'true') return true;
  if (s === 'false' || s === '0' || s === '') return false;
  if (/^\d{1,2}$/.test(s)) return Number(s);
  const list = s.split(',').map((x) => x.trim()).filter(Boolean);
  const KEYWORDS = new Set(['loopback', 'linklocal', 'uniquelocal']);
  // An address with a prefix length within its family (/32 for IPv4, /128 for IPv6): an out-of-range
  // mask would pass here and crash Fastify's proxy-address compiler at startup instead of failing config.
  const validEntry = (x: string) => {
    const m = PROXY_ENTRY.exec(x);
    if (!m) return false;
    const family = isIP(m[1]!);
    if (family === 0) return false;
    return m[2] === undefined || Number(m[2].slice(1)) <= (family === 4 ? 32 : 128);
  };
  if (list.length && list.every((x) => KEYWORDS.has(x) || validEntry(x))) return list;
  throw new Error('TRUST_PROXY must be true, false, a hop count or a comma-separated list of proxy IPs/CIDRs');
}
const trustProxy = z.string().default('false').transform((v, ctx) => {
  try { return parseTrustProxy(v); } catch (e) { ctx.addIssue({ code: z.ZodIssueCode.custom, message: (e as Error).message }); return z.NEVER; }
});
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
  TRUST_PROXY: trustProxy,
  LOG: bool(false),
  WEBHOOK_ALLOW_PRIVATE: bool(false),
  ADMIN_PASSWORD: z.string().optional(),
  WORKER_HEARTBEAT_MAX_AGE_MS: ms(15_000),
  RATE_LIMIT_ENABLED: bool(true),
  RATE_LIMIT_AUTH_PER_MIN: z.coerce.number().int().positive().default(20),
  RATE_LIMIT_PARTNER_TOKEN_PER_MIN: z.coerce.number().int().positive().default(30),
  RATE_LIMIT_BETS_PER_MIN: z.coerce.number().int().positive().default(120),
  WEB_URL: z.string().url().default('http://localhost:5173'),
  MAIL_FROM: z.string().min(3).max(200).default('PreFlop <no-reply@preflop.local>'),
  SMTP_URL: z.string().url().refine((v) => /^smtps?:\/\//i.test(v), 'must start with smtp:// or smtps://').optional(),
  JEV_API_KEY: z.string().min(16).optional(),
  JEV_API_URL: z.string().url().default('https://api.typesafe.ai/v1/systemone'),
  JEV_MODEL: z.string().min(1).max(80).default('jev-latest'),
  KYC_PROVIDER: z.enum(['sandbox', 'none']).optional(),
  PSP_PROVIDER: z.enum(['sandbox', 'none']).optional(),
  CUSTODY_PROVIDER: z.enum(['sandbox', 'none']).optional(),
});
type Env = z.infer<typeof Env>;

/**
 * Secrets read from the environment, checked in production (≥ 32 characters, not a demo value).
 * Add a line here for every new secret. Today the only server-side secret is the database
 * password; partner client secrets and webhook secrets are generated and stored in the database.
 */
const SECRETS: { name: string; get: (e: Env) => string | undefined; min?: number }[] = [
  // Managed Postgres (e.g. Neon) generates ~16-character random passwords: strong, but shorter than 32.
  { name: 'DATABASE_URL password', min: 16, get: (e) => { try { return decodeURIComponent(new URL(e.DATABASE_URL).password) || undefined; } catch { return undefined; } } },
  // TypeSafe AI issues the key; its length is theirs to choose, so only the demo check and a floor apply.
  { name: 'JEV_API_KEY', min: 16, get: (e) => e.JEV_API_KEY },
];

/**
 * A database host on a private network (local, Docker service name, Fly private network) needs no TLS.
 * IP literals other than loopback (e.g. a public IPv6 address) are never treated as private.
 */
export const isPrivateDbHost = (host: string): boolean =>
  ['localhost', '127.0.0.1', '::1', '[::1]'].includes(host) ||
  (!host.includes(':') && !host.includes('[') && (!host.includes('.') || /\.(internal|flycast|local)$/.test(host)));

/**
 * One CORS_ORIGINS entry may hold a single `*` inside a host label, for per-deployment preview
 * URLs (e.g. https://preflop-staging-web-*-team.vercel.app). The `*` matches letters and digits
 * only, never a dash or a dot, so it cannot reach into another label or another account's names.
 */
const WILDCARD_ORIGIN = /^https:\/\/[a-z0-9-]*[a-z0-9]-\*-[a-z0-9][a-z0-9-]*(\.[a-z0-9-]+)+$/;

/** The origins as @fastify/cors expects them: `true` for "*", otherwise exact strings and anchored patterns. */
export function corsOrigin(origins: string[]): true | (string | RegExp)[] {
  if (origins.includes('*')) return true;
  const literal = (p: string) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return origins.map((o) => (o.includes('*') ? new RegExp(`^${o.split('*').map(literal).join('[a-z0-9]+')}$`) : o));
}

/** Production-only refusals. Returns every problem found (empty = OK). */
export function productionProblems(raw: NodeJS.ProcessEnv, e: Env): string[] {
  const problems: string[] = [];
  const cors = (raw.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (cors.length === 0) problems.push('CORS_ORIGINS must list the allowed origins (comma-separated); it is empty');
  else if (cors.includes('*')) problems.push('CORS_ORIGINS must not be "*" in production; list the web, console and table origins');
  for (const o of cors) {
    if (o !== '*' && o.includes('*') && !WILDCARD_ORIGIN.test(o)) {
      problems.push(`CORS_ORIGINS entry ${o} is too broad; a wildcard must be one "-*-" inside an https host label`);
    }
  }
  if (raw.TRUST_PROXY?.trim() === 'true') {
    problems.push('TRUST_PROXY=true trusts every X-Forwarded-For hop, so a client can forge its address and bypass per-IP limits; set the number of proxy hops (1 behind Fly or one load balancer) or the proxies\' CIDRs');
  }
  if (!raw.DATABASE_URL) problems.push('DATABASE_URL must be set in production (the localhost default is for development)');
  else {
    // A database reached over the internet (e.g. Neon) must use verified TLS.
    try {
      const u = new URL(e.DATABASE_URL);
      const mode = u.searchParams.get('sslmode');
      if (!isPrivateDbHost(u.hostname) && mode !== 'verify-full' && mode !== 'require') {
        problems.push(`DATABASE_URL points at ${u.hostname} without TLS; add ?sslmode=verify-full`);
      }
    } catch { /* malformed URLs are reported by the schema */ }
  }
  for (const s of SECRETS) {
    const v = s.get(e);
    if (v === undefined) continue;
    if (isDemoSecret(v)) problems.push(`${s.name} is a known demo/default value; generate a random one (e.g. openssl rand -base64 48)`);
    else if (v.length < (s.min ?? MIN_SECRET_LENGTH)) problems.push(`${s.name} is ${v.length} characters; it must be at least ${s.min ?? MIN_SECRET_LENGTH}`);
  }
  if (e.ADMIN_PASSWORD !== undefined) {
    const why = passwordWeakness(e.ADMIN_PASSWORD);
    if (why) problems.push(`ADMIN_PASSWORD ${why}`);
  }
  if (e.SMTP_URL) {
    // Real mail goes out: the sender and the links in it must be the deployment's own.
    if (!raw.MAIL_FROM) problems.push('MAIL_FROM must be set when SMTP_URL is set (e.g. "PreFlop <no-reply@your-domain>")');
    else if (/@preflop\.local>?$/i.test(e.MAIL_FROM.trim())) problems.push('MAIL_FROM must be an address of your own domain, not the development default');
    if (!raw.WEB_URL) problems.push('WEB_URL must be set when SMTP_URL is set: links in emails point at the public player web app');
    else {
      try {
        const w = new URL(e.WEB_URL);
        if (w.protocol !== 'https:' || isPrivateDbHost(w.hostname)) problems.push(`WEB_URL ${e.WEB_URL} must be the public https address of the player web app`);
      } catch { /* malformed URLs are reported by the schema */ }
    }
  }
  if (e.JEV_API_KEY && !/^https:\/\//i.test(e.JEV_API_URL)) problems.push('JEV_API_URL must be https: the key travels in the Authorization header');
  for (const [name, v] of [['KYC_PROVIDER', e.KYC_PROVIDER], ['PSP_PROVIDER', e.PSP_PROVIDER], ['CUSTODY_PROVIDER', e.CUSTODY_PROVIDER]] as const) {
    if (v === 'sandbox') problems.push(`${name}=sandbox never runs in production: it verifies anyone and completes every payment without moving money; leave it unset (none) until a real provider is configured (docs/21)`);
  }
  if (!e.RATE_LIMIT_ENABLED) problems.push('RATE_LIMIT_ENABLED=false is for tests and the soak only');
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
  // Without a choice, development and tests get the sandbox; production fails closed.
  const defaultProvider: ProviderName = e.NODE_ENV === 'production' ? 'none' : 'sandbox';
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
    rateLimit: {
      enabled: e.RATE_LIMIT_ENABLED,
      authPerMinute: e.RATE_LIMIT_AUTH_PER_MIN,
      partnerTokenPerMinute: e.RATE_LIMIT_PARTNER_TOKEN_PER_MIN,
      betsPerMinute: e.RATE_LIMIT_BETS_PER_MIN,
    },
    workerHeartbeatMaxAgeMs: e.WORKER_HEARTBEAT_MAX_AGE_MS,
    mail: { from: e.MAIL_FROM, webUrl: e.WEB_URL.replace(/\/+$/, ''), smtpUrl: e.SMTP_URL ?? null },
    decisions: { apiKey: e.JEV_API_KEY ?? null, url: e.JEV_API_URL, model: e.JEV_MODEL },
    providers: {
      kyc: e.KYC_PROVIDER ?? defaultProvider,
      psp: e.PSP_PROVIDER ?? defaultProvider,
      custody: e.CUSTODY_PROVIDER ?? defaultProvider,
    },
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
