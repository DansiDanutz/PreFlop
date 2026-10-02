import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app.ts';
import { userFromToken } from '../auth/players.ts';
import { type DomainEvent, bus } from '../lib/events.ts';

/**
 * WS /v1/stream — subscribe with {"subscribe": ["table:<id>", "lobby", "tournament:<id>"]}. Round,
 * price and tournament events are public. To also receive your own bet events, send
 * {"type": "auth", "token": "<session>"} as the FIRST frame; the server answers
 * {"type": "auth", "ok": true|false}. The token is never read from the URL: URLs end up in proxy
 * and access logs, frames do not. An auth frame after the first one is ignored, so a socket can
 * never switch users.
 */
export async function streamRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/v1/stream', { websocket: true }, async (socket) => {
    ctx.stats.wsClients++;
    socket.on('close', () => { ctx.stats.wsClients--; });
    const topics = new Set<string>();
    let userId: string | null = null;
    let first = true;
    const send = (m: unknown) => { if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(m)); };
    const onEvent = (e: DomainEvent) => {
      const forUser = e.userId !== undefined;
      const forTopic = e.topic !== undefined && topics.has(e.topic);
      if (forTopic || (forUser ? userId !== null && e.userId === userId : e.topic === undefined && (topics.has('lobby') || (e.tableId && topics.has(`table:${e.tableId}`))))) {
        send({ type: e.type, table_id: e.tableId, round_id: e.roundId, data: e.data, at: Date.now() });
      }
    };
    bus.on('event', onEvent);
    socket.on('close', () => bus.off('event', onEvent));
    socket.on('message', async (raw: Buffer) => {
      let m: { type?: unknown; token?: unknown; subscribe?: unknown; unsubscribe?: unknown };
      try { m = JSON.parse(raw.toString()) as typeof m; } catch { first = false; return; /* ignore malformed */ }
      const isFirst = first;
      first = false;
      if (m?.type === 'auth') {
        if (!isFirst || typeof m.token !== 'string' || !m.token) return send({ type: 'auth', ok: false });
        try { userId = (await userFromToken(ctx.db, m.token)).id; } catch { userId = null; }
        return send({ type: 'auth', ok: userId !== null });
      }
      for (const t of Array.isArray(m?.subscribe) ? m.subscribe : []) topics.add(String(t));
      for (const t of Array.isArray(m?.unsubscribe) ? m.unsubscribe : []) topics.delete(String(t));
      send({ type: 'subscribed', topics: [...topics] });
    });
    send({ type: 'hello', user: false });
  });
}
