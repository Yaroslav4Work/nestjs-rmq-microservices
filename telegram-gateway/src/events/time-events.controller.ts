import { Controller, Inject, Logger } from '@nestjs/common';
import {
  ClientProxy,
  Ctx,
  EventPattern,
  Payload,
  RmqContext,
  RmqRecordBuilder,
} from '@nestjs/microservices';
import { firstValueFrom } from 'rxjs';
import { ProcessedEventStatus } from '../generated/prisma/enums';
import { PrismaService } from '../database/prisma.service';
import {
  type EventEnvelope,
  type FailedEventEnvelope,
  TIME_EVENT_CREATED,
  TIME_EVENT_FAILED,
  TimeEvent,
} from './events';
import { TelegramService } from '../telegram/telegram.service';

type RmqChannel = {
  ack: (message: unknown) => void;
  nack: (message: unknown, allUpTo?: boolean, requeue?: boolean) => void;
};

@Controller()
export class TimeEventsController {
  private readonly logger = new Logger(TimeEventsController.name);
  private readonly maxAttempts = 5;

  constructor(
    private readonly prisma: PrismaService,
    private readonly telegramService: TelegramService,
    @Inject('TIME_EVENTS_DLQ_CLIENT')
    private readonly dlqClient: ClientProxy,
  ) {}

  @EventPattern(TIME_EVENT_CREATED)
  async handleTimeEvent(
    @Payload() envelope: EventEnvelope<TimeEvent>,
    @Ctx() context: RmqContext,
  ): Promise<void> {
    const channel = context.getChannelRef() as RmqChannel;
    const message = context.getMessage() as unknown;

    try {
      const existing = await this.prisma.processedEvent.findUnique({
        where: { correlationId: envelope.correlationId },
      });

      if (existing?.status === ProcessedEventStatus.PROCESSED) {
        channel.ack(message);
        this.logger.log(`Skipped duplicate event ${envelope.correlationId}`);
        return;
      }

      if (existing && existing.attempts >= this.maxAttempts) {
        await this.publishToDlqOrRequeue(
          envelope,
          existing.lastError ?? 'Max processing attempts exceeded',
          channel,
          message,
        );
        return;
      }

      await this.prisma.processedEvent.upsert({
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

      await this.telegramService.sendTimeEvent(envelope.payload);

      await this.prisma.processedEvent.update({
        where: { correlationId: envelope.correlationId },
        data: {
          status: ProcessedEventStatus.PROCESSED,
          processedAt: new Date(),
          lastError: null,
        },
      });

      channel.ack(message);
      this.logger.log(`Processed event ${envelope.correlationId}`);
    } catch (error) {
      const attempts = await this.markFailed(envelope, error);

      if (attempts >= this.maxAttempts) {
        await this.publishToDlqOrRequeue(envelope, error, channel, message);
      } else {
        channel.nack(message, false, true);
      }

      this.logger.error(
        `Failed to process event ${envelope.correlationId}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  private async markFailed(
    envelope: EventEnvelope<TimeEvent>,
    error: unknown,
  ): Promise<number> {
    const savedEvent = await this.prisma.processedEvent.upsert({
      where: { correlationId: envelope.correlationId },
      update: {
        status: ProcessedEventStatus.FAILED,
        lastError: error instanceof Error ? error.message : String(error),
      },
      create: {
        correlationId: envelope.correlationId,
        eventName: envelope.eventName,
        status: ProcessedEventStatus.FAILED,
        attempts: 1,
        payload: envelope,
        lastError: error instanceof Error ? error.message : String(error),
      },
    });

    return savedEvent.attempts;
  }

  private async publishToDlqOrRequeue(
    envelope: EventEnvelope<TimeEvent>,
    error: unknown,
    channel: RmqChannel,
    message: unknown,
  ): Promise<void> {
    try {
      await this.publishToDlq(envelope, error);
      channel.ack(message);
      this.logger.error(
        `Event ${envelope.correlationId} exceeded max attempts and was sent to DLQ`,
      );
    } catch (dlqError) {
      channel.nack(message, false, true);
      this.logger.error(
        `Failed to publish event ${envelope.correlationId} to DLQ; message was requeued`,
        dlqError instanceof Error ? dlqError.stack : undefined,
      );
    }
  }

  private async publishToDlq(
    envelope: EventEnvelope<TimeEvent>,
    error: unknown,
  ): Promise<void> {
    const failedEnvelope: FailedEventEnvelope<TimeEvent> = {
      correlationId: envelope.correlationId,
      eventName: TIME_EVENT_FAILED,
      failedAt: new Date().toISOString(),
      reason: error instanceof Error ? error.message : String(error),
      payload: envelope,
    };
    const record = new RmqRecordBuilder(failedEnvelope)
      .setOptions({
        contentType: 'application/json',
        persistent: true,
        messageId: envelope.correlationId,
        timestamp: Date.now(),
      })
      .build();

    await firstValueFrom(this.dlqClient.emit(TIME_EVENT_FAILED, record));
  }
}
