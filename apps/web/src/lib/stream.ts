import { type StreamEvent, connectStream } from '@preflop/client';
import { useEffect, useRef, useState } from 'react';
import { WS_URL, notifyUnauthorized } from './api.ts';
import type { StreamStatus } from './live.ts';

/**
 * Wraps a socket status listener and reports a *re*-open: an 'open' that follows a drop. Events
 * sent while the socket was down are gone, so whatever the screen built from them (round state,
 * pending bets) must be refetched. The first open is not a reconnect.
 */
export function reconnectTracker(onReconnect: () => void) {
  let opened = false;
  let dropped = false;
  return (s: StreamStatus) => {
    if (s === 'open') {
      if (opened && dropped) onReconnect();
      opened = true;
      dropped = false;
    } else if (s === 'closed' && opened) {
      dropped = true;
    }
  };
}

/** The stream refused the token it was sent (`{type:'auth', ok:false}`): the session is gone, as after a REST 401. */
export const authRejected = (e: StreamEvent) => e.type === 'auth' && (e as { ok?: unknown }).ok === false;

/** Routes one stream frame: a refused auth frame signs the session out, everything else goes to the screen. */
export function dispatchFrame(e: StreamEvent, onEvent: (e: StreamEvent) => void) {
  if (authRejected(e)) notifyUnauthorized();
  else onEvent(e);
}

/**
 * Subscribes to WS /v1/stream topics for the lifetime of the component. The handler can change
 * between renders without reconnecting. Pass a token to also receive your own bet events, and
 * `onReconnect` to refetch what the events would have patched while the socket was down.
 */
export function useStream(topics: string[], onEvent: (e: StreamEvent) => void, token?: string | null, onReconnect?: () => void) {
  const handler = useRef(onEvent);
  handler.current = onEvent;
  const reconnect = useRef(onReconnect);
  reconnect.current = onReconnect;
  const [status, setStatus] = useState<StreamStatus>('connecting');
  const key = topics.join('|');
  useEffect(() => {
    if (typeof WebSocket === 'undefined') return;
    const track = reconnectTracker(() => reconnect.current?.());
    const s = connectStream({
      url: WS_URL,
      topics: key ? key.split('|') : [],
      token: token ?? null,
      onEvent: (e) => dispatchFrame(e, handler.current),
      onStatus: (st) => { setStatus(st); track(st); },
    });
    return () => s.close();
  }, [key, token]);
  return status;
}
