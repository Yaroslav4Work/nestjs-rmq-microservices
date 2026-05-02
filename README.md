# Time Telegram Microservices

Тестовый проект на NestJS: producer-сервис периодически создает события времени, публикует их в RabbitMQ через transactional outbox, consumer-сервис получает события и отправляет уведомления в Telegram.

## Состав

- `time-service` - producer.
- `telegram-gateway` - consumer и Telegram bot gateway.
- `postgres` - хранение outbox, processed events и Telegram chat id.
- `rabbitmq` - брокер сообщений.
- `redis` - backend для BullMQ.

## Архитектура

`time-service` каждые 30 секунд создает событие `time.created` с текущим `Date.now()`. Событие сначала сохраняется в таблицу `OutboxEvent` со статусом `PENDING`, затем ставится задача в BullMQ queue `outbox-relay`.

Отдельный BullMQ worker `OutboxProcessor` забирает job, читает пачку pending-событий из outbox и публикует их в RabbitMQ через стандартный NestJS `ClientProxy`. Scheduled trigger каждые 5 секунд также ставит relay-job, чтобы pending-события не зависали после рестарта или временных ошибок. У relay-job стабильный `jobId`, поэтому trigger не создает пачку одинаковых jobs во время деградации RabbitMQ.

После успешной публикации outbox-запись переводится в `SENT`. При ошибке увеличивается `attempts`, сохраняется `lastError`, рассчитывается `nextAttemptAt` с экспоненциальной задержкой. После лимита попыток запись переводится в `FAILED`. BullMQ job тоже имеет `attempts` и `exponential backoff`, поэтому временная проблема инфраструктуры не превращается в tight retry loop.

`telegram-gateway` слушает очередь RabbitMQ через NestJS RMQ microservice transport с ручным `ack/nack`. Для идемпотентности каждое событие сохраняется в `ProcessedEvent` по `correlationId`. Если событие уже `PROCESSED`, оно подтверждается без повторной отправки в Telegram.

Если обработка события падает, consumer делает `nack` с requeue, пока не исчерпан лимит попыток. После лимита событие публикуется в отдельную durable DLQ queue `time.events.dlq` с pattern `time.created.failed`, а исходное сообщение подтверждается через `ack`, чтобы остановить redelivery loop. Если публикация в DLQ тоже падает, consumer делает `nack` с requeue, чтобы событие не потерялось.

Telegram-бот реализован через `nestjs-telegraf`. Пользователь отправляет боту `/start`, сервис сохраняет `chatId` в таблицу `TelegramChat`, после чего все активные чаты получают уведомления по событиям из RabbitMQ.

Telegram-рассылка изолирует ошибки отдельных chat id: если отправка в один чат падает, этот чат деактивируется, остальные активные чаты продолжают получать событие. Это предотвращает повторную обработку всего события и дубли у пользователей, которым сообщение уже было доставлено.

## Запуск

Создать `.env` в корне:

```bash
cp .env.example .env
```

Указать токен Telegram-бота:

```env
TELEGRAM_BOT_TOKEN=123456:replace-me
```

Запустить проект:

```bash
docker compose --env-file .env up --build
```

Если проект уже запускался до добавления отдельных баз данных, нужно один раз пересоздать volume Postgres:

```bash
docker compose down -v
docker compose --env-file .env up --build
```

## Проверка

Health endpoints:

- `http://localhost:3001/health` - `time-service`.
- `http://localhost:3000/health` - `telegram-gateway`.

Swagger:

- `http://localhost:3001/docs` - `time-service`.
- `http://localhost:3000/docs` - `telegram-gateway`.

Debug endpoints:

- `GET http://localhost:3001/debug/outbox/stats`
- `GET http://localhost:3001/debug/outbox/pending`
- `GET http://localhost:3001/debug/outbox/sent`
- `GET http://localhost:3001/debug/outbox/failed`
- `GET http://localhost:3000/debug/events/stats`
- `GET http://localhost:3000/debug/events/processed`
- `GET http://localhost:3000/debug/events/failed`
- `GET http://localhost:3000/debug/telegram/chats`

List endpoints accept optional `take` query param, capped at `100`.

RabbitMQ Management UI:

- `http://localhost:15672`
- login: `admin`
- password: `password123`

Redis доступен на `localhost:6379`.

Telegram:

1. Создать бота через `@BotFather`.
2. Положить токен в `.env`.
3. Запустить сервисы.
4. Написать боту `/start`.
5. Дождаться события от `time-service`; уведомления приходят примерно раз в 30 секунд.

Команда `/stop` отключает рассылку для текущего Telegram chat id. Повторный `/start` включает рассылку обратно.

Если `TELEGRAM_BOT_TOKEN` пустой, `telegram-gateway` все равно стартует, но Telegraf polling не запускается, а отправка сообщений пропускается с warning-логом. Это удобно для локальной проверки RabbitMQ/БД без реального бота.

## Переменные окружения

Корневой `.env`:

```env
TELEGRAM_BOT_TOKEN=123456:replace-me
```

`time-service`:

```env
PORT=3001
DATABASE_URL=postgresql://myuser:mysecretpassword@localhost:5432/time_service
RABBITMQ_URL=amqp://admin:password123@localhost:5672
RABBITMQ_QUEUE=time.events.queue
REDIS_HOST=localhost
REDIS_PORT=6379
```

`telegram-gateway`:

```env
PORT=3000
DATABASE_URL=postgresql://myuser:mysecretpassword@localhost:5432/telegram_gateway
RABBITMQ_URL=amqp://admin:password123@localhost:5672
RABBITMQ_QUEUE=time.events.queue
RABBITMQ_DLQ_QUEUE=time.events.dlq
TELEGRAM_BOT_TOKEN=123456:replace-me
```

## Локальная разработка без Docker

Сначала поднять Postgres, RabbitMQ и Redis, например через:

```bash
docker compose up postgres rabbitmq redis
```

`time-service`:

```bash
cd time-service
cp .env.example .env
npm install
npx prisma migrate deploy
npx prisma generate
npm run start:dev
```

`telegram-gateway`:

```bash
cd telegram-gateway
cp .env.example .env
npm install
npx prisma migrate deploy
npx prisma generate
npm run start:dev
```

## Тесты

Запуск unit-тестов:

```bash
cd time-service
npm test
```

```bash
cd telegram-gateway
npm test
```

Покрыт наиболее важный reliability-код:

- `time-service`: создание outbox event, постановка BullMQ relay-job, успешная публикация, retry-state при ошибке RabbitMQ, переход в `FAILED` после лимита попыток.
- `telegram-gateway`: идемпотентность по `correlationId`, успешный `ack`, `nack` при временной ошибке Telegram, остановка redelivery loop после лимита попыток.

## Надежность

- Transactional outbox в producer защищает от потери события между записью бизнес-факта и публикацией в RabbitMQ.
- BullMQ используется как отдельный relay worker для outbox.
- BullMQ job имеет `attempts: 10` и exponential backoff с базовой задержкой 1 секунду.
- Каждое событие имеет `correlationId`.
- Producer хранит retry-state каждой outbox-записи в БД.
- Consumer использует manual ack.
- Consumer хранит обработанные `correlationId` и не отправляет Telegram-сообщение повторно для уже обработанного события.
- Consumer публикует событие в DLQ после исчерпания retry attempts.
- Если DLQ publish недоступен, consumer requeue-ит исходное сообщение вместо потери события.
- Telegram delivery errors изолируются на уровне chat id; проблемный chat деактивируется.
- Ошибки публикации и обработки сохраняются в БД через `lastError`.
- RabbitMQ queue durable, сообщения отправляются с `persistent: true`.
- Оба сервиса валидируют обязательные env-переменные на старте.
- Оба сервиса включают NestJS shutdown hooks для graceful shutdown.

## Компромиссы

- Relay worker реализован через BullMQ, но запускается внутри процесса `time-service`, а не как отдельный Docker service. Для тестового задания этого достаточно: код worker-а отделен, retry/backoff есть, инфраструктура проще. В production можно вынести worker в отдельный контейнер с тем же кодом и отдельной командой запуска.
- В системе есть два уровня retry: BullMQ retry для relay-job и outbox retry-state для каждой записи. Это сделано намеренно: BullMQ отвечает за повтор запуска worker job, outbox-таблица остается источником правды по конкретному событию.
- Используется стандартный NestJS RMQ `ClientProxy`, без низкоуровневого `amqplib`. Это проще, лучше соответствует NestJS-подходу и уменьшает количество инфраструктурного кода. Цена компромисса - меньше ручного контроля над exchange/routing topology.
- Publisher confirmation реализован как ожидание завершения `ClientProxy.emit()` через `firstValueFrom`. Для тестового задания это приемлемый NestJS-level ack публикации, но это не полноценные RabbitMQ publisher confirms на уровне confirm channel. Для production-критичного exactly-once-ish outbox relay лучше использовать confirm channel или отдельный publisher abstraction на `amqplib`.
- Producer публикует в очередь через Nest RMQ transport, без отдельного exchange/routing-key слоя. Для текущего сценария одна очередь и один тип события достаточны. Если появятся несколько consumers или разные типы событий, стоит добавить exchange и routing keys.
- Retry consumer сделан через `nack` с requeue и лимитом попыток в БД. После лимита событие публикуется в application-level DLQ через NestJS `ClientProxy`. Для production-сценария можно заменить это на broker-level DLX, delayed retry exchange и отдельный DLQ consumer.
- Telegram работает через long polling Telegraf. Это проще для локального запуска. Для production можно переключить на webhook behind HTTPS.
- Архитектура модульная и разделена по сервисам Nest, но это не строгая Clean Architecture: доменная логика в сервисах всё еще напрямую использует Prisma, Nest RMQ и Telegraf SDK. Для тестового это осознанный компромисс ради читаемости и скорости; при росте проекта стоит вынести порты/адаптеры для repository, message publisher и notification gateway.
- Swagger добавлен для health/debug endpoints. Debug endpoints read-only и нужны для проверки состояния outbox, обработанных событий и Telegram chat registrations.
- Покрытие тестами сфокусировано на reliability-логике. Следующий полезный слой тестов: e2e smoke test с RabbitMQ test container и mocked Telegram bot.

## Возможные улучшения

- Вынести BullMQ worker в отдельный Docker service.
- DLQ consumer или admin endpoint для просмотра `time.events.dlq`.
- Простая авторизация для debug/admin endpoints, если запускать сервисы вне локального окружения.
- Metrics: количество `PENDING`, `FAILED`, `PROCESSED`, время обработки.
- Отдельные Docker stages с `npm ci` после фиксации актуальных `package-lock.json`.
- Более строгая schema-based env validation через `joi` или аналог.

## Структура данных

`time-service`:

- `OutboxEvent`
  - `correlationId`
  - `eventName`
  - `payload`
  - `status`
  - `attempts`
  - `nextAttemptAt`
  - `lastError`

BullMQ:

- queue: `outbox-relay`
- job: `relay-pending-outbox`
- jobId: `relay-pending-outbox`
- attempts: `10`
- backoff: exponential, base delay `1000ms`

RabbitMQ:

- main queue: `time.events.queue`
- DLQ queue: `time.events.dlq`
- DLQ pattern: `time.created.failed`

`telegram-gateway`:

- `TelegramChat`
  - `chatId`
  - `firstName`
  - `username`
  - `isActive`
- `ProcessedEvent`
  - `correlationId`
  - `eventName`
  - `status`
  - `attempts`
  - `payload`
  - `lastError`
