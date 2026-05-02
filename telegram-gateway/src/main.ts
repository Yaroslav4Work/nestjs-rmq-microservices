import { NestFactory } from '@nestjs/core';
import { Transport } from '@nestjs/microservices';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();

  app.connectMicroservice({
    transport: Transport.RMQ,
    options: {
      urls: [
        process.env.RABBITMQ_URL ?? 'amqp://admin:password123@localhost:5672',
      ],
      queue: process.env.RABBITMQ_QUEUE ?? 'time.events.queue',
      noAck: false,
      queueOptions: {
        durable: true,
      },
    },
  });
  await app.startAllMicroservices();

  const swaggerConfig = new DocumentBuilder()
    .setTitle('telegram-gateway')
    .setDescription('RabbitMQ consumer and Telegram notification gateway')
    .setVersion('1.0')
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, swaggerDocument);

  await app.listen(process.env.PORT ?? 3000);
}
void bootstrap();
