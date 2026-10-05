import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app.ts';
import { audit } from '../lib/audit.ts';
import { tx } from '../lib/db.ts';
import { notFound } from '../lib/errors.ts';
import { settlePayment } from '../payments/service.ts';
import type { ProviderEvent, WebhookHandler } from '../providers/types.ts';

/** Providers deliver small JSON documents; anything larger is not a webhook. */
export const WEBHOOK_MAX_BODY = 256 * 1024;

/**
 * Inbound provider webhooks (docs/21): `POST /v1/webhooks/:provider`. The adapter named `:provider`
 * authenticates the delivery from the raw body and the headers (never from parsed JSON) and returns
 * the events to apply; this route applies them in one transaction:
 *
 * - payment events settle the pending payment named by (provider, ref): deposits and purchases post
 *   to the ledger, a failed payout is refunded (payments/service.ts settlePayment);
 * - KYC events move the user named by (kyc_provider, ref) to verified, rejected or pending.
 *
 * Every delivery is audited, including ones for unknown references, and the answer is 200 once the
 * events are stored, so the provider stops retrying. A bad signature is 401 and changes nothing.
 * There is no authentication other than the provider's signature: the route is unreachable for the
 * sandbox, which has no webhook.
 */
export async function webhookRoutes(app: FastifyInstance, ctx: AppContext) {
  await app.register(async (sub) => {
    // The signature covers the exact bytes the provider sent: in this scope every body stays raw.
    sub.removeAllContentTypeParsers();
    sub.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit: WEBHOOK_MAX_BODY }, (req, body, done) => {
      req.rawBody = body as Buffer;
      done(null, body);
    });
    sub.post<{ Params: { provider: string } }>('/v1/webhooks/:provider', { bodyLimit: WEBHOOK_MAX_BODY }, async (req, reply) => {
      const name = req.params.provider;
      const handlers: WebhookHandler[] = [];
      for (const p of [ctx.providers.kyc, ctx.providers.psp, ctx.providers.custody]) {
        if (p && p.name === name && p.webhook && !handlers.includes(p.webhook)) handlers.push(p.webhook);
      }
      if (handlers.length === 0) throw notFound('webhook');
      const raw = req.rawBody ?? Buffer.alloc(0);
      const events: ProviderEvent[] = [];
      for (const h of handlers) events.push(...(await h(req.headers, raw)));
      const applied = await tx(ctx.db, async (c) => {
        let n = 0;
        for (const ev of events) {
          if (ev.type === 'payment') {
            const row = await settlePayment(c, name, ev.ref, ev.status, ev.details ?? {});
            if (row) n++;
            else await audit(c, { type: 'webhook.unknown_payment', provider: name, ref: ev.ref, status: ev.status });
          } else {
            const r = await c.query<{ id: string }>(
              `update users set kyc_status = $3 where kyc_provider = $1 and kyc_ref = $2 and kyc_status <> 'verified' returning id`, [name, ev.ref, ev.status]);
            const userId = r.rows[0]?.id;
            if (userId) { n++; await audit(c, { type: `kyc.${ev.status}`, userId, provider: name, ref: ev.ref, via: 'webhook' }); }
            else await audit(c, { type: 'webhook.unknown_kyc', provider: name, ref: ev.ref, status: ev.status });
          }
        }
        return n;
      });
      return reply.code(200).send({ received: events.length, applied });
    });
  });
}
