import { type StreamEvent, connectStream } from '@preflop/client';
import { useEffect, useRef, useState } from 'react';
import { WS_URL } from './api.ts';
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
      onEvent: (e) => handler.current(e),
      onStatus: (st) => { setStatus(st); track(st); },
    });
    return () => s.close();
  }, [key, token]);
  return status;
}
