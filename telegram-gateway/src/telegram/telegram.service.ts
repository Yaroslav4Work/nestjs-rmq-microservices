import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectBot } from 'nestjs-telegraf';
import { Telegraf } from 'telegraf';
import { PrismaService } from '../database/prisma.service';
import { TimeEvent } from '../events/events';

export type TelegramChatInfo = {
  id: number;
  first_name?: string;
  username?: string;
};

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);
  private readonly token?: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    @InjectBot()
    private readonly bot: Telegraf,
  ) {
    this.token = this.configService.get<string>('TELEGRAM_BOT_TOKEN');
  }

  async registerChat(chat: TelegramChatInfo): Promise<void> {
    await this.prisma.telegramChat.upsert({
      where: { chatId: String(chat.id) },
      update: {
        firstName: chat.first_name,
        username: chat.username,
        isActive: true,
      },
      create: {
        chatId: String(chat.id),
        firstName: chat.first_name,
        username: chat.username,
      },
    });

    await this.sendMessage(String(chat.id), 'Chat registered for time events.');
    this.logger.log(`Registered Telegram chat ${chat.id}`);
  }

  async stopChat(chat: TelegramChatInfo): Promise<void> {
    await this.prisma.telegramChat.upsert({
      where: { chatId: String(chat.id) },
      update: {
        firstName: chat.first_name,
        username: chat.username,
        isActive: false,
      },
      create: {
        chatId: String(chat.id),
        firstName: chat.first_name,
        username: chat.username,
        isActive: false,
      },
    });

    await this.sendMessage(
      String(chat.id),
      'Time event notifications stopped.',
    );
    this.logger.log(`Stopped Telegram chat ${chat.id}`);
  }

  async sendTimeEvent(event: TimeEvent): Promise<void> {
    const chats = await this.prisma.telegramChat.findMany({
      where: { isActive: true },
    });

    const date = new Date(event.now);
    const text = `Time event: ${date.toISOString()} (${event.now})`;

    for (const chat of chats) {
      try {
        await this.sendMessage(chat.chatId, text);
      } catch (error) {
        await this.prisma.telegramChat.update({
          where: { chatId: chat.chatId },
          data: { isActive: false },
        });
        this.logger.error(
          `Failed to send Telegram message to chat ${chat.chatId}; chat was deactivated`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }
  }

  private async sendMessage(chatId: string, text: string): Promise<void> {
    if (!this.token) {
      this.logger.warn(
        `Telegram token is not configured, skipped chat ${chatId}`,
      );
      return;
    }

    await this.bot.telegram.sendMessage(chatId, text);
  }
}
