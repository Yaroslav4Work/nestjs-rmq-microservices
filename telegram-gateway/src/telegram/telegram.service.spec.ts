/* eslint-disable @typescript-eslint/no-unsafe-argument */
jest.mock('../database/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TelegramService } from './telegram.service';

describe('TelegramService', () => {
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
    telegramChat: {
      findMany: jest.fn(),
      update: jest.fn(),
      upsert: jest.fn(),
    },
  });

  const createConfigMock = () => ({
    get: jest.fn((key: string) =>
      key === 'TELEGRAM_BOT_TOKEN' ? 'token' : undefined,
    ),
  });

  const createBotMock = () => ({
    telegram: {
      sendMessage: jest.fn(),
    },
  });

  const createService = () => {
    const prisma = createPrismaMock();
    const config = createConfigMock();
    const bot = createBotMock();
    const service = new TelegramService(
      config as unknown as ConfigService,
      prisma as any,
      bot as any,
    );

    return { service, prisma, bot };
  };

  it('continues sending and deactivates only failed chat', async () => {
    const { service, prisma, bot } = createService();

    prisma.telegramChat.findMany.mockResolvedValue([
      { chatId: 'bad-chat' },
      { chatId: 'good-chat' },
    ]);
    bot.telegram.sendMessage
      .mockRejectedValueOnce(new Error('chat blocked bot'))
      .mockResolvedValueOnce(undefined);

    await service.sendTimeEvent({ now: 1_700_000_000_000 });

    expect(bot.telegram.sendMessage).toHaveBeenCalledTimes(2);
    expect(bot.telegram.sendMessage).toHaveBeenNthCalledWith(
      1,
      'bad-chat',
      expect.any(String),
    );
    expect(bot.telegram.sendMessage).toHaveBeenNthCalledWith(
      2,
      'good-chat',
      expect.any(String),
    );
    expect(prisma.telegramChat.update).toHaveBeenCalledWith({
      where: { chatId: 'bad-chat' },
      data: { isActive: false },
    });
  });
});
