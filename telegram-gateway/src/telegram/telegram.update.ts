import { Logger } from '@nestjs/common';
import { Command, Ctx, Start, Update } from 'nestjs-telegraf';
import { Context } from 'telegraf';
import { TelegramService } from './telegram.service';

@Update()
export class TelegramUpdate {
  private readonly logger = new Logger(TelegramUpdate.name);

  constructor(private readonly telegramService: TelegramService) {}

  @Start()
  async start(@Ctx() ctx: Context): Promise<void> {
    const chat = this.getChat(ctx, '/start');

    if (chat) {
      await this.telegramService.registerChat(chat);
    }
  }

  @Command('stop')
  async stop(@Ctx() ctx: Context): Promise<void> {
    const chat = this.getChat(ctx, '/stop');

    if (chat) {
      await this.telegramService.stopChat(chat);
    }
  }

  private getChat(
    ctx: Context,
    command: string,
  ): { id: number; first_name?: string; username?: string } | null {
    const chat = ctx.chat;

    if (!chat) {
      this.logger.warn(`Received ${command} without chat context`);
      return null;
    }

    return {
      id: chat.id,
      first_name: 'first_name' in chat ? chat.first_name : undefined,
      username: 'username' in chat ? chat.username : undefined,
    };
  }
}
