/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */
jest.mock('../database/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import { of, throwError } from 'rxjs';
import { RmqRecord } from '@nestjs/microservices';
import { ProcessedEventStatus } from '../generated/prisma/enums';
import {
  FailedEventEnvelope,
  TIME_EVENT_CREATED,
  TIME_EVENT_FAILED,
  TimeEvent,
} from './events';
import { TimeEventsController } from './time-events.controller';

describe('TimeEventsController', () => {
  type DlqRecord = RmqRecord<FailedEventEnvelope<TimeEvent>>;
  type DlqClientMock = ReturnType<typeof createDlqClientMock>;

  const envelope = {
    correlationId: 'event-1',
    eventName: TIME_EVENT_CREATED,
    occurredAt: new Date().toISOString(),
    payload: { now: 1_700_000_000_000 },
  };

  const createPrismaMock = () => ({
    processedEvent: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
    },
  });

  const createTelegramMock = () => ({
    sendTimeEvent: jest.fn(),
  });

  const createDlqClientMock = () => ({
    emit: jest.fn((pattern: string, record: DlqRecord) =>
      of({ pattern, record }),
    ),
  });

  const createContextMock = () => {
    const message = { fields: { deliveryTag: 1 } };
    const channel = {
      ack: jest.fn(),
      nack: jest.fn(),
    };

    return {
      message,
      channel,
      context: {
        getChannelRef: () => channel,
        getMessage: () => message,
      },
    };
  };

  const createController = () => {
    const prisma = createPrismaMock();
    const telegram = createTelegramMock();
    const dlqClient = createDlqClientMock();
    const controller = new TimeEventsController(
      prisma as any,
      telegram as any,
      dlqClient as any,
    );

    return { controller, prisma, telegram, dlqClient };
  };

  const getFirstEmitCall = (dlqClient: DlqClientMock) => {
    const call = dlqClient.emit.mock.calls[0];

    if (!call) {
      throw new Error('Expected DLQ client emit to be called');
    }

    return call;
  };

  it('acks duplicate processed event without sending Telegram message', async () => {
    const { controller, prisma, telegram } = createController();
    const { context, channel, message } = createContextMock();

    prisma.processedEvent.findUnique.mockResolvedValue({
      correlationId: envelope.correlationId,
      status: ProcessedEventStatus.PROCESSED,
    });

    await controller.handleTimeEvent(envelope, context as any);

    expect(telegram.sendTimeEvent).not.toHaveBeenCalled();
    expect(channel.ack).toHaveBeenCalledWith(message);
    expect(channel.nack).not.toHaveBeenCalled();
  });

  it('sends Telegram message, marks event as processed, and acks delivery', async () => {
    const { controller, prisma, telegram } = createController();
    const { context, channel, message } = createContextMock();

    prisma.processedEvent.findUnique.mockResolvedValue(null);
    prisma.processedEvent.upsert.mockResolvedValue({
      correlationId: envelope.correlationId,
      attempts: 1,
    });

    await controller.handleTimeEvent(envelope, context as any);

    expect(prisma.processedEvent.upsert).toHaveBeenCalledWith({
      where: { correlationId: envelope.correlationId },
      update: {
        attempts: { increment: 1 },
        lastError: null,
        status: ProcessedEventStatus.PROCESSING,
        payload: envelope,
      },
      create: {
        correlationId: envelope.correlationId,
        eventName: envelope.eventName,
        attempts: 1,
        payload: envelope,
      },
    });
    expect(telegram.sendTimeEvent).toHaveBeenCalledWith(envelope.payload);
    expect(prisma.processedEvent.update).toHaveBeenCalledWith({
      where: { correlationId: envelope.correlationId },
      data: {
        status: ProcessedEventStatus.PROCESSED,
        processedAt: expect.any(Date),
        lastError: null,
      },
    });
    expect(channel.ack).toHaveBeenCalledWith(message);
    expect(channel.nack).not.toHaveBeenCalled();
  });

  it('nacks failed delivery when retry attempts remain', async () => {
    const { controller, prisma, telegram, dlqClient } = createController();
    const { context, channel, message } = createContextMock();

    prisma.processedEvent.findUnique.mockResolvedValue(null);
    prisma.processedEvent.upsert
      .mockResolvedValueOnce({
        correlationId: envelope.correlationId,
        attempts: 1,
      })
      .mockResolvedValueOnce({
        correlationId: envelope.correlationId,
        attempts: 1,
      });
    telegram.sendTimeEvent.mockRejectedValue(new Error('telegram down'));

    await controller.handleTimeEvent(envelope, context as any);

    expect(prisma.processedEvent.upsert).toHaveBeenLastCalledWith({
      where: { correlationId: envelope.correlationId },
      update: {
        status: ProcessedEventStatus.FAILED,
        lastError: 'telegram down',
      },
      create: {
        correlationId: envelope.correlationId,
        eventName: envelope.eventName,
        status: ProcessedEventStatus.FAILED,
        attempts: 1,
        payload: envelope,
        lastError: 'telegram down',
      },
    });
    expect(channel.nack).toHaveBeenCalledWith(message, false, true);
    expect(channel.ack).not.toHaveBeenCalled();
    expect(dlqClient.emit).not.toHaveBeenCalled();
  });

  it('publishes failed event to DLQ and acks delivery after max attempts', async () => {
    const { controller, prisma, telegram, dlqClient } = createController();
    const { context, channel, message } = createContextMock();

    prisma.processedEvent.findUnique.mockResolvedValue({
      correlationId: envelope.correlationId,
      status: ProcessedEventStatus.FAILED,
      attempts: 4,
    });
    prisma.processedEvent.upsert
      .mockResolvedValueOnce({
        correlationId: envelope.correlationId,
        attempts: 5,
      })
      .mockResolvedValueOnce({
        correlationId: envelope.correlationId,
        attempts: 5,
      });
    telegram.sendTimeEvent.mockRejectedValue(new Error('telegram down'));

    await controller.handleTimeEvent(envelope, context as any);

    expect(dlqClient.emit).toHaveBeenCalledTimes(1);
    const [pattern, record] = getFirstEmitCall(dlqClient);
    expect(pattern).toBe(TIME_EVENT_FAILED);
    expect(record.data).toEqual({
      correlationId: envelope.correlationId,
      eventName: TIME_EVENT_FAILED,
      failedAt: expect.any(String),
      reason: 'telegram down',
      payload: envelope,
    });
    expect(record.options).toEqual({
      contentType: 'application/json',
      persistent: true,
      messageId: envelope.correlationId,
      timestamp: expect.any(Number),
    });
    expect(channel.ack).toHaveBeenCalledWith(message);
    expect(channel.nack).not.toHaveBeenCalled();
  });

  it('nacks and requeues when DLQ publish fails', async () => {
    const { controller, prisma, telegram, dlqClient } = createController();
    const { context, channel, message } = createContextMock();

    prisma.processedEvent.findUnique.mockResolvedValue({
      correlationId: envelope.correlationId,
      status: ProcessedEventStatus.FAILED,
      attempts: 4,
    });
    prisma.processedEvent.upsert
      .mockResolvedValueOnce({
        correlationId: envelope.correlationId,
        attempts: 5,
      })
      .mockResolvedValueOnce({
        correlationId: envelope.correlationId,
        attempts: 5,
      });
    telegram.sendTimeEvent.mockRejectedValue(new Error('telegram down'));
    dlqClient.emit.mockReturnValue(
      throwError(() => new Error('dlq publish failed')),
    );

    await controller.handleTimeEvent(envelope, context as any);

    expect(dlqClient.emit).toHaveBeenCalledTimes(1);
    expect(channel.nack).toHaveBeenCalledWith(message, false, true);
    expect(channel.ack).not.toHaveBeenCalled();
  });
});
