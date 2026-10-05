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
/** Largest frame a client may send (subscribe/auth frames are tiny). Set on the websocket plugin. */
export const STREAM_MAX_PAYLOAD = 4096;

/**
 * Connection health. Every `pingMs` the server pings; a socket that has not answered the previous
 * ping is terminated (half-open TCP, a sleeping phone). A client that reads slower than events
 * arrive is cut off once more than `maxBufferedBytes` wait in its send buffer, instead of buffering
 * without bound; it reconnects and refetches. Mutable for tests only.
 */
export const streamTuning = { pingMs: 30_000, maxBufferedBytes: 1 << 20, maxTopics: 50 };
/** The topics a socket may follow: the lobby, one table, one tournament or one room by id. Anything else is ignored. */
export const TOPIC = /^(lobby|(table|tournament|room):[A-Za-z0-9_.:-]{1,80})$/;

export async function streamRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/v1/stream', { websocket: true }, async (socket) => {
    ctx.stats.wsClients++;
    socket.on('close', () => { ctx.stats.wsClients--; });
    const topics = new Set<string>();
    let userId: string | null = null;
    let token: string | null = null;
    let first = true;
    let alive = true;
    socket.on('pong', () => { alive = true; });
    const ping = setInterval(() => {
      if (!alive) { socket.terminate(); return; }
      alive = false;
      try { socket.ping(); } catch { socket.terminate(); }
      // A session revoked meanwhile (sign-out everywhere, password change, suspension) stops the
      // per-user events at the next ping instead of at the next reconnect.
      if (userId && token) {
        userFromToken(ctx.db, token).catch(() => null).then((u) => {
          if (!u && userId) { userId = null; token = null; send({ type: 'auth', ok: false }); }
        });
      }
    }, streamTuning.pingMs);
    ping.unref?.();
    socket.on('close', () => clearInterval(ping));
    const send = (m: unknown) => {
      if (socket.readyState !== socket.OPEN) return;
      if (socket.bufferedAmount > streamTuning.maxBufferedBytes) { socket.terminate(); return; }
      socket.send(JSON.stringify(m));
    };
    const onEvent = (e: DomainEvent) => {
      if (e.type === 'relay.gap') {
        // This process missed other instances' events while its relay was down (lib/events.ts):
        // 1012 "service restart" makes the client reconnect and refetch, as after any drop.
        socket.close(1012, 'stream resync');
        return;
      }
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
        try { userId = (await userFromToken(ctx.db, m.token)).id; token = m.token; } catch { userId = null; token = null; }
        return send({ type: 'auth', ok: userId !== null });
      }
      // Topics are validated and capped: an unbounded set costs memory and a scan per event.
      for (const t of Array.isArray(m?.subscribe) ? m.subscribe : []) {
        const name = String(t);
        if (!TOPIC.test(name)) continue;
        if (topics.size >= streamTuning.maxTopics && !topics.has(name)) break;
        topics.add(name);
      }
      for (const t of Array.isArray(m?.unsubscribe) ? m.unsubscribe : []) topics.delete(String(t));
      send({ type: 'subscribed', topics: [...topics] });
    });
    send({ type: 'hello', user: false });
  });
}
