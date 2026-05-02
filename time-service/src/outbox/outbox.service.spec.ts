/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */
jest.mock('../database/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import { of, throwError } from 'rxjs';
import { Logger } from '@nestjs/common';
import { RmqRecord } from '@nestjs/microservices';
import { OutboxEventStatus } from '../generated/prisma/enums';
import { EventEnvelope, TIME_EVENT_CREATED, TimeEvent } from '../events';
import { RELAY_PENDING_OUTBOX_JOB } from './outbox.constants';
import { OutboxService } from './outbox.service';

describe('OutboxService', () => {
  type TimeEventRecord = RmqRecord<EventEnvelope<TimeEvent>>;
  type ClientMock = ReturnType<typeof createClientMock>;

  let loggerErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    loggerErrorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    loggerErrorSpy.mockRestore();
  });

  const createPrismaMock = () => ({
    outboxEvent: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  });

  const createClientMock = () => ({
    emit: jest.fn((pattern: string, record: TimeEventRecord) =>
      of({ pattern, record }),
    ),
  });

  const createQueueMock = () => ({
    add: jest.fn(),
  });

  const createService = () => {
    const prisma = createPrismaMock();
    const client = createClientMock();
    const queue = createQueueMock();
    const service = new OutboxService(
      prisma as any,
      client as any,
      queue as any,
    );

    return { service, prisma, client, queue };
  };

  const getFirstEmitCall = (client: ClientMock) => {
    const call = client.emit.mock.calls[0];

    if (!call) {
      throw new Error('Expected RabbitMQ client emit to be called');
    }

    return call;
  };

  it('stores a time event in outbox and schedules relay job', async () => {
    const { service, prisma, queue } = createService();

    await service.createTimeEvent(1_700_000_000_000);

    expect(prisma.outboxEvent.create).toHaveBeenCalledWith({
      data: {
        correlationId: expect.any(String),
        eventName: TIME_EVENT_CREATED,
        payload: {
          correlationId: expect.any(String),
          eventName: TIME_EVENT_CREATED,
          occurredAt: expect.any(String),
          payload: { now: 1_700_000_000_000 },
        },
      },
    });
    expect(queue.add).toHaveBeenCalledWith(
      RELAY_PENDING_OUTBOX_JOB,
      {},
      {
        jobId: RELAY_PENDING_OUTBOX_JOB,
        attempts: 10,
        backoff: { type: 'exponential', delay: 1_000 },
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  });

  it('publishes pending outbox event and marks it as sent', async () => {
    const { service, prisma, client } = createService();
    const envelope = {
      correlationId: 'event-1',
      eventName: TIME_EVENT_CREATED,
      occurredAt: new Date().toISOString(),
      payload: { now: 1 },
    };
    const event = {
      id: 'outbox-1',
      correlationId: envelope.correlationId,
      status: OutboxEventStatus.PENDING,
      attempts: 0,
      maxAttempts: 10,
      payload: envelope,
    };

    prisma.outboxEvent.findMany.mockResolvedValue([event]);
    prisma.outboxEvent.findUnique.mockResolvedValue(event);

    await service.relayPendingEvents();

    expect(client.emit).toHaveBeenCalledTimes(1);
    const [pattern, record] = getFirstEmitCall(client);
    expect(pattern).toBe(TIME_EVENT_CREATED);
    expect(record.data).toEqual(envelope);
    expect(record.options).toEqual({
      contentType: 'application/json',
      persistent: true,
      messageId: envelope.correlationId,
      timestamp: expect.any(Number),
    });
    expect(prisma.outboxEvent.update).toHaveBeenCalledWith({
      where: { id: event.id },
      data: {
        status: OutboxEventStatus.SENT,
        publishedAt: expect.any(Date),
        lastError: null,
      },
    });
  });

  it('keeps failed publish as pending and lets BullMQ retry the relay job', async () => {
    const { service, prisma, client } = createService();
    const event = {
      id: 'outbox-1',
      correlationId: 'event-1',
      status: OutboxEventStatus.PENDING,
      attempts: 0,
      maxAttempts: 10,
      payload: {
        correlationId: 'event-1',
        eventName: TIME_EVENT_CREATED,
        occurredAt: new Date().toISOString(),
        payload: { now: 1 },
      },
    };

    prisma.outboxEvent.findMany.mockResolvedValue([event]);
    prisma.outboxEvent.findUnique.mockResolvedValue(event);
    client.emit.mockReturnValue(throwError(() => new Error('rmq down')));

    await expect(service.relayPendingEvents()).rejects.toThrow(
      'Failed to relay 1 outbox events',
    );

    expect(prisma.outboxEvent.update).toHaveBeenCalledWith({
      where: { id: event.id },
      data: {
        attempts: 1,
        status: OutboxEventStatus.PENDING,
        nextAttemptAt: expect.any(Date),
        lastError: 'rmq down',
      },
    });
  });

  it('marks outbox event as failed after max attempts', async () => {
    const { service, prisma, client } = createService();
    const event = {
      id: 'outbox-1',
      correlationId: 'event-1',
      status: OutboxEventStatus.PENDING,
      attempts: 9,
      maxAttempts: 10,
      payload: {
        correlationId: 'event-1',
        eventName: TIME_EVENT_CREATED,
        occurredAt: new Date().toISOString(),
        payload: { now: 1 },
      },
    };

    prisma.outboxEvent.findMany.mockResolvedValue([event]);
    prisma.outboxEvent.findUnique.mockResolvedValue(event);
    client.emit.mockReturnValue(throwError(() => new Error('rmq down')));

    await service.relayPendingEvents();

    expect(prisma.outboxEvent.update).toHaveBeenCalledWith({
      where: { id: event.id },
      data: {
        attempts: 10,
        status: OutboxEventStatus.FAILED,
        nextAttemptAt: expect.any(Date),
        lastError: 'rmq down',
      },
    });
  });
});
