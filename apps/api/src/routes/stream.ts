import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../app.ts';
import { userFromToken } from '../auth/players.ts';
import { type DomainEvent, bus } from '../lib/events.ts';

/**
 * WS /v1/stream — subscribe with {"subscribe": ["table:<id>", "lobby", "tournament:<id>"]}. Pass ?token=<session>
 * to also receive your own bet events. Round and price events are public; bet events go only
 * to their owner.
 */
export async function streamRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/v1/stream', { websocket: true }, async (socket, req) => {
    // Counted from the first moment, so a socket that closes during the token lookup is not leaked.
    ctx.stats.wsClients++;
    socket.on('close', () => { ctx.stats.wsClients--; });
    const topics = new Set<string>();
    let userId: string | null = null;
    const token = (req.query as { token?: string }).token;
    if (token) {
      try { userId = (await userFromToken(ctx.db, token)).id; } catch { userId = null; }
    }
    if (socket.readyState !== socket.OPEN) return; // closed during the lookup: never subscribe it
    const onEvent = (e: DomainEvent) => {
      const forUser = e.userId !== undefined;
      const forTopic = e.topic !== undefined && topics.has(e.topic);
      if (forTopic || (forUser ? e.userId === userId : e.topic === undefined && (topics.has('lobby') || (e.tableId && topics.has(`table:${e.tableId}`))))) {
        socket.send(JSON.stringify({ type: e.type, table_id: e.tableId, round_id: e.roundId, data: e.data, at: Date.now() }));
      }
    };
    bus.on('event', onEvent);
    socket.on('message', (raw: Buffer) => {
      try {
        const m = JSON.parse(raw.toString()) as { subscribe?: string[]; unsubscribe?: string[] };
        for (const t of m.subscribe ?? []) topics.add(String(t));
        for (const t of m.unsubscribe ?? []) topics.delete(String(t));
        socket.send(JSON.stringify({ type: 'subscribed', topics: [...topics] }));
      } catch { /* ignore malformed */ }
    });
    socket.on('close', () => bus.off('event', onEvent));
    socket.send(JSON.stringify({ type: 'hello', user: userId !== null }));
  });
}
