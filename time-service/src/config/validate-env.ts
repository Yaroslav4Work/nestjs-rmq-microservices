type TimeServiceEnv = {
  PORT: string;
  DATABASE_URL: string;
  RABBITMQ_URL: string;
  RABBITMQ_QUEUE: string;
  REDIS_HOST: string;
  REDIS_PORT: string;
};

const DEFAULT_ENV: TimeServiceEnv = {
  PORT: '3001',
  DATABASE_URL: '',
  RABBITMQ_URL: 'amqp://admin:password123@localhost:5672',
  RABBITMQ_QUEUE: 'time.events.queue',
  REDIS_HOST: 'localhost',
  REDIS_PORT: '6379',
};

const REQUIRED_KEYS = ['DATABASE_URL'] as const;

export const validateEnv = (
  config: Record<string, string | undefined>,
): TimeServiceEnv => {
  const env = { ...DEFAULT_ENV, ...config };
  const missingKeys = REQUIRED_KEYS.filter((key) => !env[key]);

  if (missingKeys.length > 0) {
    throw new Error(`Missing environment variables: ${missingKeys.join(', ')}`);
  }

  assertUrl('DATABASE_URL', env.DATABASE_URL);
  assertUrl('RABBITMQ_URL', env.RABBITMQ_URL);
  assertPort('PORT', env.PORT);
  assertPort('REDIS_PORT', env.REDIS_PORT);

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
