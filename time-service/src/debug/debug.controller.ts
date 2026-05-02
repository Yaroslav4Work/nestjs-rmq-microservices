import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { OutboxEventStatus } from '../generated/prisma/enums';
import { PrismaService } from '../database/prisma.service';

@ApiTags('debug')
@Controller('debug')
export class DebugController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('outbox/pending')
  @ApiOperation({ summary: 'Recent pending outbox events' })
  @ApiQuery({ name: 'take', required: false, example: 20 })
  async pendingOutbox(@Query('take') take?: string) {
    return this.findOutboxEvents(OutboxEventStatus.PENDING, take);
  }

  @Get('outbox/sent')
  @ApiOperation({ summary: 'Recent sent outbox events' })
  @ApiQuery({ name: 'take', required: false, example: 20 })
  async sentOutbox(@Query('take') take?: string) {
    return this.findOutboxEvents(OutboxEventStatus.SENT, take);
  }

  @Get('outbox/failed')
  @ApiOperation({ summary: 'Recent failed outbox events' })
  @ApiQuery({ name: 'take', required: false, example: 20 })
  async failedOutbox(@Query('take') take?: string) {
    return this.findOutboxEvents(OutboxEventStatus.FAILED, take);
  }

  @Get('outbox/stats')
  @ApiOperation({ summary: 'Outbox event counters by status' })
  async outboxStats() {
    const [pending, sent, failed] = await Promise.all([
      this.prisma.outboxEvent.count({
        where: { status: OutboxEventStatus.PENDING },
      }),
      this.prisma.outboxEvent.count({
        where: { status: OutboxEventStatus.SENT },
      }),
      this.prisma.outboxEvent.count({
        where: { status: OutboxEventStatus.FAILED },
      }),
    ]);

    return { pending, sent, failed };
  }

  private findOutboxEvents(status: OutboxEventStatus, take?: string) {
    return this.prisma.outboxEvent.findMany({
      where: { status },
      orderBy: { createdAt: 'desc' },
      take: this.parseTake(take),
    });
  }

  private parseTake(value?: string): number {
    const take = Number(value ?? 20);

    if (!Number.isInteger(take) || take <= 0) {
      return 20;
    }

    return Math.min(take, 100);
  }
}
