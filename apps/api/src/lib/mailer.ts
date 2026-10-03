import nodemailer from 'nodemailer';
import type { Config } from '../config.ts';
import type { Db, Tx } from './db.ts';

/**
 * Outgoing email. Messages are written to email_outbox inside the transaction that needs them
 * (registration, password reset), and the worker hands them to a transport:
 *
 * - SMTP_URL set (smtp:// or smtps://, any environment): SMTP through nodemailer, sender MAIL_FROM
 *   (required in production when SMTP_URL is set, see config.ts);
 * - otherwise, development and test: the log transport prints each message (and its link);
 * - otherwise, production: messages stay queued and the API logs a warning at start.
 *
 * Links in the messages point at WEB_URL (the public player web app).
 */

export interface Mail { to: string; subject: string; text: string; template: 'verify_email' | 'reset_password' }

export interface MailTransport {
  readonly name: string;
  send(m: Mail & { from: string }): Promise<void>;
}

/** Prints the message: links are visible in the terminal during development. */
export const logTransport: MailTransport = {
  name: 'log',
  async send(m) {
    console.log(`[mail] to=${m.to} subject="${m.subject}"\n${m.text}\n`);
  },
};

/** The minimal nodemailer surface used here (a test can pass a fake). */
export interface SmtpSender { sendMail(m: { from: string; to: string; subject: string; text: string }): Promise<unknown> }

/** SMTP through nodemailer. The URL carries host, port, credentials and TLS (smtps:// = implicit TLS). */
export function smtpTransport(smtpUrl: string, create: (url: string) => SmtpSender = (url) => nodemailer.createTransport(url)): MailTransport {
  const proto = new URL(smtpUrl).protocol;
  if (proto !== 'smtp:' && proto !== 'smtps:') throw new Error(`SMTP_URL must start with smtp:// or smtps:// (got ${proto})`);
  const sender = create(smtpUrl);
  return {
    name: proto === 'smtps:' ? 'smtps' : 'smtp',
    async send(m) {
      await sender.sendMail({ from: m.from, to: m.to, subject: m.subject, text: m.text });
    },
  };
}

/** The transport for this configuration, or null when none is available (messages stay queued). */
export function mailTransportFor(config: Config): MailTransport | null {
  if (config.mail.smtpUrl) return smtpTransport(config.mail.smtpUrl);
  if (config.nodeEnv !== 'production') return logTransport;
  return null;
}

/** A start-up warning when production cannot send email, or null. */
export function mailWarning(config: Config): string | null {
  if (config.nodeEnv !== 'production' || config.mail.smtpUrl) return null;
  return 'SMTP_URL is not set: verification and password-reset emails stay queued in email_outbox until it is';
}

/** Queues one message in the caller's transaction. */
export async function queueMail(c: Tx, m: Mail): Promise<void> {
  await c.query('insert into email_outbox (to_email, template, subject, body) values ($1, $2, $3, $4)', [m.to, m.template, m.subject, m.text]);
}

/** Attempts per message before it is marked failed. */
export const MAIL_MAX_ATTEMPTS = 8;
/** Wait before attempt n+1 after n failures: 1 min, 2, 4, … capped at 6 h. */
export const mailBackoffMs = (failures: number): number => Math.min(6 * 3_600_000, 60_000 * 2 ** Math.max(0, failures - 1));

/** Counters of this process, for GET /v1/admin/metrics. */
export const mailStats = { sent: 0, failedAttempts: 0, gaveUp: 0 };

/**
 * Sends up to `limit` due messages. Each row is claimed with SKIP LOCKED, so several workers
 * never send one twice. A sent message keeps its row (audit of what was sent) but loses its body,
 * which may hold a live link. A failure counts one attempt and schedules the next one with
 * exponential backoff (next_attempt_at); a message is tried at most once per call, so one worker
 * pass never burns through its retries. After MAIL_MAX_ATTEMPTS it is marked failed (logged and
 * counted in the metrics).
 */
export async function deliverMail(db: Db, transport: MailTransport | null, from: string, limit = 20): Promise<number> {
  if (!transport) return 0;
  let sent = 0;
  const tried: number[] = [];
  for (let i = 0; i < limit; i++) {
    const c = await db.connect();
    try {
      await c.query('begin');
      const m = (await c.query<{ id: number; to_email: string; template: Mail['template']; subject: string; body: string; attempts: number }>(
        `select id, to_email, template, subject, body, attempts from email_outbox
          where status = 'pending' and next_attempt_at <= now() and not (id = any($1::bigint[]))
          order by next_attempt_at, id limit 1 for update skip locked`, [tried])).rows[0];
      if (!m) {
        await c.query('commit');
        break;
      }
      tried.push(m.id);
      try {
        await transport.send({ from, to: m.to_email, subject: m.subject, text: m.body, template: m.template });
        await c.query(`update email_outbox set status = 'sent', sent_at = now(), attempts = attempts + 1, body = '', last_error = null where id = $1`, [m.id]);
        mailStats.sent++;
        sent++;
      } catch (e) {
        const attempts = m.attempts + 1;
        const error = String((e as Error).message).slice(0, 300);
        const gaveUp = attempts >= MAIL_MAX_ATTEMPTS;
        await c.query(
          `update email_outbox set attempts = $2, last_error = $3,
                  status = case when $4 then 'failed' else 'pending' end,
                  failed_at = case when $4 then now() end,
                  next_attempt_at = now() + ($5 || ' milliseconds')::interval
            where id = $1`, [m.id, attempts, error, gaveUp, String(mailBackoffMs(attempts))]);
        mailStats.failedAttempts++;
        if (gaveUp) mailStats.gaveUp++;
        console.warn(`[mail] ${gaveUp ? 'giving up on' : 'will retry'} message ${m.id} (${m.template}) after attempt ${attempts}/${MAIL_MAX_ATTEMPTS} via ${transport.name}: ${error}`);
      }
      await c.query('commit');
    } catch (e) {
      await c.query('rollback').catch(() => {});
      throw e;
    } finally {
      c.release();
    }
  }
  return sent;
}
