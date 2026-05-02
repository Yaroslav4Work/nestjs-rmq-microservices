import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OutboxService } from './outbox/outbox.service';

@Injectable()
export class AppService {
  private readonly logger = new Logger(AppService.name);

  constructor(private readonly outboxService: OutboxService) {}

  getHello(): string {
    return 'time-service is running';
  }

  @Cron(CronExpression.EVERY_30_SECONDS)
  async processTime(): Promise<void> {
    await this.outboxService.createTimeEvent();
    this.logger.log('Scheduled time event');
  }
}
