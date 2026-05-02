import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ScheduleModule } from '@nestjs/schedule';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { ClientsModule, Transport } from '@nestjs/microservices';
import { PrismaService } from './database/prisma.service';
import { OutboxService } from './outbox/outbox.service';
import { OUTBOX_RELAY_QUEUE } from './outbox/outbox.constants';
import { OutboxProcessor } from './outbox/outbox.processor';
import { validateEnv } from './config/validate-env';
import { DebugController } from './debug/debug.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    ScheduleModule.forRoot(),
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST ?? 'localhost',
        port: Number(process.env.REDIS_PORT ?? 6379),
      },
    }),
    BullModule.registerQueue({
      name: OUTBOX_RELAY_QUEUE,
    }),
    ClientsModule.register([
      {
        name: 'TIME_EVENTS_CLIENT',
        transport: Transport.RMQ,
        options: {
          urls: [
            process.env.RABBITMQ_URL ??
              'amqp://admin:password123@localhost:5672',
          ],
          queue: process.env.RABBITMQ_QUEUE ?? 'time.events.queue',
          persistent: true,
          queueOptions: {
            durable: true,
          },
        },
      },
    ]),
  ],
  controllers: [AppController, DebugController],
  providers: [AppService, PrismaService, OutboxService, OutboxProcessor],
})
export class AppModule {}
