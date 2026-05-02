import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { TelegrafModule } from 'nestjs-telegraf';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaService } from './database/prisma.service';
import { TimeEventsController } from './events/time-events.controller';
import { TelegramService } from './telegram/telegram.service';
import { TelegramUpdate } from './telegram/telegram.update';
import { validateEnv } from './config/validate-env';
import { DebugController } from './debug/debug.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    TelegrafModule.forRootAsync({
      useFactory: (configService: ConfigService) => {
        const token = configService.get<string>('TELEGRAM_BOT_TOKEN') ?? '';

        return {
          token: token || 'not-configured',
          launchOptions: token ? { dropPendingUpdates: true } : false,
        };
      },
      inject: [ConfigService],
    }),
    ClientsModule.register([
      {
        name: 'TIME_EVENTS_DLQ_CLIENT',
        transport: Transport.RMQ,
        options: {
          urls: [
            process.env.RABBITMQ_URL ??
              'amqp://admin:password123@localhost:5672',
          ],
          queue: process.env.RABBITMQ_DLQ_QUEUE ?? 'time.events.dlq',
          persistent: true,
          queueOptions: {
            durable: true,
          },
        },
      },
    ]),
  ],
  controllers: [AppController, TimeEventsController, DebugController],
  providers: [AppService, PrismaService, TelegramService, TelegramUpdate],
})
export class AppModule {}
