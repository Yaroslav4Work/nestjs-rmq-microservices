export const TIME_EVENT_CREATED = 'time.created';

export type EventEnvelope<Event> = {
  correlationId: string;
  eventName: string;
  occurredAt: string;
  payload: Event;
};

export type TimeEvent = {
  now: number;
};
