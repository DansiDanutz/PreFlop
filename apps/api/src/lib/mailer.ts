import type { Config } from '../config.ts';
import type { Db, Tx } from './db.ts';

/**
 * Outgoing email. Messages are written to email_outbox inside the transaction that needs them
 * (registration, password reset), and the worker hands them to a transport. No email provider is
 * integrated yet, and no mail library is installed:
 *
 * - development and test: the log transport prints each message (and its link) to stdout;
 * - production: messages stay queued and the API logs a warning at start, until a provider is
 *   plugged in. To plug one, implement MailTransport (an HTTP API such as SES, Postmark or
 *   SendGrid needs only fetch) and return it from mailTransportFor(); SMTP_URL and MAIL_FROM are
 *   already read into config.mail. Queued messages are sent once a transport exists.
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

/**
 * The transport for this configuration, or null when none is available (messages stay queued).
 * This is the one place to wire a real provider.
 */
export function mailTransportFor(config: Config): MailTransport | null {
  if (config.nodeEnv !== 'production') return logTransport;
  return null;
}

/** A start-up warning when production cannot send email, or null. */
export function mailWarning(config: Config): string | null {
  if (config.nodeEnv !== 'production' || mailTransportFor(config)) return null;
  return config.mail.smtpUrl
    ? 'SMTP_URL is set, but this build has no SMTP transport: emails stay queued in email_outbox (see lib/mailer.ts to plug a provider)'
    : 'no email provider is configured: verification and password-reset emails stay queued in email_outbox (see lib/mailer.ts)';
}

/** Queues one message in the caller's transaction. */
export async function queueMail(c: Tx, m: Mail): Promise<void> {
  await c.query('insert into email_outbox (to_email, template, subject, body) values ($1, $2, $3, $4)', [m.to, m.template, m.subject, m.text]);
}

/**
 * Sends up to `limit` queued messages. Each row is claimed with SKIP LOCKED, so several workers
 * never send one twice. A sent message keeps its row (audit of what was sent) but loses its body,
 * which may hold a live link. Failures are retried on later ticks, at most 10 times.
 */
export async function deliverMail(db: Db, transport: MailTransport | null, from: string, limit = 20): Promise<number> {
  if (!transport) return 0;
  let sent = 0;
  for (let i = 0; i < limit; i++) {
    const c = await db.connect();
    try {
      await c.query('begin');
      const m = (await c.query<{ id: number; to_email: string; template: Mail['template']; subject: string; body: string }>(
        `select id, to_email, template, subject, body from email_outbox where sent_at is null and attempts < 10 order by id limit 1 for update skip locked`)).rows[0];
      if (!m) {
        await c.query('commit');
        break;
      }
      try {
        await transport.send({ from, to: m.to_email, subject: m.subject, text: m.body, template: m.template });
        await c.query(`update email_outbox set sent_at = now(), attempts = attempts + 1, body = '', last_error = null where id = $1`, [m.id]);
        sent++;
      } catch (e) {
        await c.query('update email_outbox set attempts = attempts + 1, last_error = $2 where id = $1', [m.id, String((e as Error).message).slice(0, 300)]);
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
