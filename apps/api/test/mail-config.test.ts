import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../src/config.ts';
import { type SmtpSender, mailTransportFor, mailWarning, smtpTransport } from '../src/lib/mailer.ts';

/** Email transport configuration and the docker-compose production guard (external source audit). */
const STRONG_DB = `postgres://preflop:${'k'.repeat(20)}Q7-${'z'.repeat(12)}@db.internal:5432/preflop`;
const PROD = { NODE_ENV: 'production', DATABASE_URL: STRONG_DB, CORS_ORIGINS: 'https://preflop.example.com' };
const MAIL = { SMTP_URL: 'smtps://mailer:s3cret@smtp.mail.example.com:465', MAIL_FROM: 'PreFlop <no-reply@preflop.example.com>', WEB_URL: 'https://preflop.example.com' };

function problemsOf(env: NodeJS.ProcessEnv): string[] {
  try {
    loadConfig(env);
    return [];
  } catch (e) {
    if (e instanceof ConfigError) return e.problems;
    throw e;
  }
}

describe('SMTP transport', () => {
  it('production with SMTP_URL builds a real SMTP transport (nodemailer) and no warning', () => {
    const config = loadConfig({ ...PROD, ...MAIL });
    const t = mailTransportFor(config);
    expect(t?.name).toBe('smtps');
    expect(mailWarning(config)).toBeNull();
    expect(mailTransportFor(loadConfig({ ...PROD, ...MAIL, SMTP_URL: 'smtp://smtp.mail.example.com:587' }))?.name).toBe('smtp');
  });

  it('production without SMTP_URL keeps mail queued and warns', () => {
    const config = loadConfig(PROD);
    expect(mailTransportFor(config)).toBeNull();
    expect(mailWarning(config)).toMatch(/SMTP_URL/);
    expect(mailTransportFor(loadConfig({}))?.name).toBe('log');
  });

  it('sends through the SMTP sender with the configured From (fake sender, no real email)', async () => {
    const sent: unknown[] = [];
    const fake = (url: string): SmtpSender => {
      expect(url).toBe(MAIL.SMTP_URL);
      return { sendMail: async (m) => { sent.push(m); } };
    };
    const t = smtpTransport(MAIL.SMTP_URL, fake);
    await t.send({ from: MAIL.MAIL_FROM, to: 'p@x.dev', subject: 'Hi', text: 'link https://preflop.example.com/verify-email?token=t', template: 'verify_email' });
    expect(sent).toEqual([{ from: MAIL.MAIL_FROM, to: 'p@x.dev', subject: 'Hi', text: 'link https://preflop.example.com/verify-email?token=t' }]);
    expect(() => smtpTransport('https://smtp.example.com', fake)).toThrow(/smtp/);
  });

  it('config: SMTP_URL must be smtp(s); with it, production needs MAIL_FROM and a public https WEB_URL', () => {
    expect(problemsOf({ SMTP_URL: 'http://smtp.example.com' })[0]).toMatch(/^SMTP_URL:/);
    expect(problemsOf({ ...PROD, ...MAIL })).toEqual([]);
    expect(problemsOf({ ...PROD, ...MAIL, MAIL_FROM: '' })).toEqual([expect.stringMatching(/MAIL_FROM must be set/)]);
    expect(problemsOf({ ...PROD, ...MAIL, MAIL_FROM: 'PreFlop <no-reply@preflop.local>' })).toEqual([expect.stringMatching(/MAIL_FROM/)]);
    expect(problemsOf({ ...PROD, ...MAIL, WEB_URL: '' })).toEqual([expect.stringMatching(/WEB_URL must be set/)]);
    expect(problemsOf({ ...PROD, ...MAIL, WEB_URL: 'http://localhost:8080' })).toEqual([expect.stringMatching(/WEB_URL/)]);
    // links point at WEB_URL
    expect(loadConfig({ ...PROD, ...MAIL, WEB_URL: 'https://preflop.example.com/' }).mail.webUrl).toBe('https://preflop.example.com');
  });
});

describe('docker-compose (F19)', () => {
  const compose = readFileSync(new URL('../../../docker-compose.yml', import.meta.url), 'utf8');
  it('has no literal database password: every service reads POSTGRES_PASSWORD, which is required', () => {
    expect(compose).not.toMatch(/POSTGRES_PASSWORD:\s*preflop/);
    expect(compose).not.toMatch(/postgres:\/\/postgres:preflop@/);
    const urls = compose.match(/postgres:\/\/[^\s"']+/g) ?? [];
    expect(urls.length).toBeGreaterThanOrEqual(2); // api and sim
    for (const u of urls) expect(u).toContain('${POSTGRES_PASSWORD:?');
    expect(compose).toMatch(/POSTGRES_PASSWORD: \$\{POSTGRES_PASSWORD:\?/);
  });

  it('the API image (NODE_ENV=production) accepts the compose URL with a generated password and refuses the old demo one', () => {
    const urlWith = (pw: string) => {
      const api = compose.slice(compose.indexOf('\n  api:'));
      const tpl = /DATABASE_URL:\s*(.+)/.exec(api)![1]!.trim();
      return tpl.replace(/\$\{POSTGRES_PASSWORD:\?[^}]*\}/, encodeURIComponent(pw));
    };
    const env = (pw: string) => ({ NODE_ENV: 'production', DATABASE_URL: urlWith(pw), CORS_ORIGINS: 'http://localhost:8080,http://localhost:8081,http://localhost:8082' });
    expect(problemsOf(env('preflop'))).toEqual([expect.stringMatching(/DATABASE_URL password is a known demo/)]);
    // what `openssl rand -hex 24` produces (.env.example)
    expect(problemsOf(env('3f9c2a7be41d08c65a1e9f0b7d2c4e8a1b6f3d5c7e9a0b2c'))).toEqual([]);
    const example = readFileSync(new URL('../../../.env.example', import.meta.url), 'utf8');
    expect(example).toMatch(/^POSTGRES_PASSWORD=/m);
  });
});
