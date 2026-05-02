export const TIME_EVENT_CREATED = 'time.created';
export const TIME_EVENT_FAILED = 'time.created.failed';

export type EventEnvelope<Event> = {
  correlationId: string;
  eventName: string;
  occurredAt: string;
  payload: Event;
};

export type FailedEventEnvelope<Event> = {
  correlationId: string;
  eventName: string;
  failedAt: string;
  reason: string;
  payload: EventEnvelope<Event>;
};

export type TimeEvent = {
  now: number;
};
