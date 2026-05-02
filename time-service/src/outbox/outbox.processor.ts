import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import {
  OUTBOX_RELAY_QUEUE,
  RELAY_PENDING_OUTBOX_JOB,
} from './outbox.constants';
import { OutboxService } from './outbox.service';

@Processor(OUTBOX_RELAY_QUEUE, {
  concurrency: 1,
})
export class OutboxProcessor extends WorkerHost {
  private readonly logger = new Logger(OutboxProcessor.name);

  constructor(private readonly outboxService: OutboxService) {
    super();
  }

  async process(job: Job): Promise<void> {
    if (job.name !== RELAY_PENDING_OUTBOX_JOB) {
      this.logger.warn(`Skipped unknown job ${job.name}`);
      return;
    }

    await this.outboxService.relayPendingEvents();
  }
}
