import { type StreamEvent, connectStream } from '@preflop/client';
import { useEffect, useRef, useState } from 'react';
import { WS_URL } from './api.ts';
import type { StreamStatus } from './live.ts';

/**
 * Subscribes to WS /v1/stream topics for the lifetime of the component. The handler can change
 * between renders without reconnecting. Pass a token to also receive your own bet events.
 */
export function useStream(topics: string[], onEvent: (e: StreamEvent) => void, token?: string | null) {
  const handler = useRef(onEvent);
  handler.current = onEvent;
  const [status, setStatus] = useState<StreamStatus>('connecting');
  const key = topics.join('|');
  useEffect(() => {
    if (typeof WebSocket === 'undefined') return;
    const s = connectStream({
      url: WS_URL,
      topics: key ? key.split('|') : [],
      token: token ?? null,
      onEvent: (e) => handler.current(e),
      onStatus: setStatus,
    });
    return () => s.close();
  }, [key, token]);
  return status;
}
