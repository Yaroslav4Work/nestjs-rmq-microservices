import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ProcessedEventStatus } from '../generated/prisma/enums';
import { PrismaService } from '../database/prisma.service';

@ApiTags('debug')
@Controller('debug')
export class DebugController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('telegram/chats')
  @ApiOperation({ summary: 'Registered Telegram chats' })
  @ApiQuery({ name: 'take', required: false, example: 20 })
  async telegramChats(@Query('take') take?: string) {
    return this.prisma.telegramChat.findMany({
      orderBy: { createdAt: 'desc' },
      take: this.parseTake(take),
    });
  }

  @Get('events/processed')
  @ApiOperation({ summary: 'Recently processed events' })
  @ApiQuery({ name: 'take', required: false, example: 20 })
  async processedEvents(@Query('take') take?: string) {
    return this.findProcessedEvents(ProcessedEventStatus.PROCESSED, take);
  }

  @Get('events/failed')
  @ApiOperation({ summary: 'Recently failed events' })
  @ApiQuery({ name: 'take', required: false, example: 20 })
  async failedEvents(@Query('take') take?: string) {
    return this.findProcessedEvents(ProcessedEventStatus.FAILED, take);
  }

  @Get('events/stats')
  @ApiOperation({ summary: 'Processed event counters by status' })
  async eventStats() {
    const [processing, processed, failed, activeChats] = await Promise.all([
      this.prisma.processedEvent.count({
        where: { status: ProcessedEventStatus.PROCESSING },
      }),
      this.prisma.processedEvent.count({
        where: { status: ProcessedEventStatus.PROCESSED },
      }),
      this.prisma.processedEvent.count({
        where: { status: ProcessedEventStatus.FAILED },
      }),
      this.prisma.telegramChat.count({
        where: { isActive: true },
      }),
    ]);

    return { processing, processed, failed, activeChats };
  }

  private findProcessedEvents(status: ProcessedEventStatus, take?: string) {
    return this.prisma.processedEvent.findMany({
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
