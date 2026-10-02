import { EventEmitter } from 'node:events';

/** A domain event published to WebSocket subscribers and webhooks AFTER its transaction commits. */
export interface DomainEvent {
  type: string;
  tableId?: string;
  roundId?: string;
  userId?: string;
  /** A named stream topic (e.g. `tournament:<id>`) for events that belong to neither a table nor a user. */
  topic?: string;
  data: Record<string, unknown>;
}

/** Collects events inside a transaction; flush() after commit. */
export class EventBatch {
  readonly events: DomainEvent[] = [];
  push(e: DomainEvent): void {
    this.events.push(e);
  }
}

export const bus = new EventEmitter();
bus.setMaxListeners(0);

export function publish(batch: EventBatch): void {
  for (const e of batch.events) bus.emit('event', e);
}
