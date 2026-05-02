import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { ClientProxy, RmqRecordBuilder } from '@nestjs/microservices';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { firstValueFrom } from 'rxjs';
import { OutboxEventStatus } from '../generated/prisma/enums';
import { PrismaService } from '../database/prisma.service';
import { EventEnvelope, TimeEvent, TIME_EVENT_CREATED } from '../events';
import {
  OUTBOX_RELAY_QUEUE,
  RELAY_PENDING_OUTBOX_JOB,
} from './outbox.constants';

@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);
  private isRelaying = false;

  constructor(
    private readonly prisma: PrismaService,
    @Inject('TIME_EVENTS_CLIENT')
    private readonly client: ClientProxy,
    @InjectQueue(OUTBOX_RELAY_QUEUE)
    private readonly outboxRelayQueue: Queue,
  ) {}

  async createTimeEvent(now = Date.now()): Promise<void> {
    const envelope: EventEnvelope<TimeEvent> = {
      correlationId: randomUUID(),
      eventName: TIME_EVENT_CREATED,
      occurredAt: new Date().toISOString(),
      payload: { now },
    };

    await this.prisma.outboxEvent.create({
      data: {
        correlationId: envelope.correlationId,
        eventName: envelope.eventName,
        payload: envelope,
      },
    });

    this.logger.log(`Created outbox event ${envelope.correlationId}`);
    await this.enqueueRelayJob();
  }

  @Cron(CronExpression.EVERY_5_SECONDS)
  async enqueueRelayJob(): Promise<void> {
    await this.outboxRelayQueue.add(
      RELAY_PENDING_OUTBOX_JOB,
      {},
      {
        jobId: RELAY_PENDING_OUTBOX_JOB,
        attempts: 10,
        backoff: {
          type: 'exponential',
          delay: 1_000,
        },
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  }

  async relayPendingEvents(): Promise<void> {
    if (this.isRelaying) {
      return;
    }

    this.isRelaying = true;
    let failedEvents = 0;

    try {
      const events = await this.prisma.outboxEvent.findMany({
        where: {
          status: OutboxEventStatus.PENDING,
          nextAttemptAt: { lte: new Date() },
        },
        orderBy: { createdAt: 'asc' },
        take: 20,
      });

      for (const event of events) {
        const published = await this.relayEvent(event.id);

        if (!published) {
          failedEvents += 1;
        }
      }

      if (failedEvents > 0) {
        throw new Error(`Failed to relay ${failedEvents} outbox events`);
      }
    } finally {
      this.isRelaying = false;
    }
  }

  private async relayEvent(id: string): Promise<boolean> {
    const event = await this.prisma.outboxEvent.findUnique({ where: { id } });

    if (!event || event.status !== OutboxEventStatus.PENDING) {
      return true;
    }

    try {
      await this.publish(event.payload as EventEnvelope<unknown>);

      await this.prisma.outboxEvent.update({
        where: { id },
        data: {
          status: OutboxEventStatus.SENT,
          publishedAt: new Date(),
          lastError: null,
        },
      });

      this.logger.log(`Published outbox event ${event.correlationId}`);
      return true;
    } catch (error) {
      const attempts = event.attempts + 1;
      const failed = attempts >= event.maxAttempts;
      const delayMs = Math.min(60_000, 2 ** attempts * 1_000);

      await this.prisma.outboxEvent.update({
        where: { id },
        data: {
          attempts,
          status: failed ? OutboxEventStatus.FAILED : OutboxEventStatus.PENDING,
          nextAttemptAt: new Date(Date.now() + delayMs),
          lastError: error instanceof Error ? error.message : String(error),
        },
      });

      this.logger.error(
        `Failed to publish outbox event ${event.correlationId}, attempt ${attempts}`,
        error instanceof Error ? error.stack : undefined,
      );

      return failed;
    }
  }

  private async publish(envelope: EventEnvelope<unknown>): Promise<void> {
    const record = new RmqRecordBuilder(envelope)
      .setOptions({
        contentType: 'application/json',
        persistent: true,
        messageId: envelope.correlationId,
        timestamp: Date.now(),
      })
      .build();

    await firstValueFrom(this.client.emit(envelope.eventName, record));
  }
}
