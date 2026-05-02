type TelegramGatewayEnv = {
  PORT: string;
  DATABASE_URL: string;
  RABBITMQ_URL: string;
  RABBITMQ_QUEUE: string;
  RABBITMQ_DLQ_QUEUE: string;
  TELEGRAM_BOT_TOKEN?: string;
};

const DEFAULT_ENV: TelegramGatewayEnv = {
  PORT: '3000',
  DATABASE_URL: '',
  RABBITMQ_URL: 'amqp://admin:password123@localhost:5672',
  RABBITMQ_QUEUE: 'time.events.queue',
  RABBITMQ_DLQ_QUEUE: 'time.events.dlq',
};

const REQUIRED_KEYS = ['DATABASE_URL'] as const;

export const validateEnv = (
  config: Record<string, string | undefined>,
): TelegramGatewayEnv => {
  const env = { ...DEFAULT_ENV, ...config };
  const missingKeys = REQUIRED_KEYS.filter((key) => !env[key]);

  if (missingKeys.length > 0) {
    throw new Error(`Missing environment variables: ${missingKeys.join(', ')}`);
  }

  assertUrl('DATABASE_URL', env.DATABASE_URL);
  assertUrl('RABBITMQ_URL', env.RABBITMQ_URL);
  assertPort('PORT', env.PORT);

  return env;
};

const assertUrl = (key: string, value: string): void => {
  try {
    new URL(value);
  } catch {
    throw new Error(`Invalid URL in environment variable ${key}`);
  }
};

const assertPort = (key: string, value: string): void => {
  const port = Number(value);

  if (!Number.isInteger(port) || port <= 0 || port > 65_535) {
    throw new Error(`Invalid port in environment variable ${key}`);
  }
};
