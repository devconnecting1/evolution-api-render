/**
 * Must be the first import of every test file: it fixes the environment read by `src/config/env.config.ts`
 * (which also loads a local `.env`, so every value that matters is set explicitly here) and replaces
 * `@api/server.module`, which would otherwise boot the whole application (Prisma, Baileys, caches, every
 * integration) on import.
 *
 * Nothing here reaches the network: telemetry, Redis, S3, Chatwoot and the real OpenAI client are off or faked.
 */
import Module from 'module';

import { recordChatbotEmit } from './chatbot-emit';

// The environment is read once, when env.config is first loaded: too late if any src module came first
if (Object.keys(require.cache).some((file) => /[\\/]src[\\/]config[\\/]env\.config\.[jt]s$/.test(file))) {
  throw new Error('test/helpers/setup.ts must be the first import of the test file (before any src module)');
}

const env: Record<string, string> = {
  NODE_ENV: 'test',
  // Silent by default (the error paths under test log on purpose). TEST_LOG_LEVEL=ERROR,WARN,LOG to debug.
  LOG_LEVEL: process.env.TEST_LOG_LEVEL || 'NONE',
  LOG_COLOR: 'false',
  LOG_BAILEYS: 'error',
  TELEMETRY_ENABLED: 'false',
  OPENAI_ENABLED: 'true',
  OPENAI_API_KEY_GLOBAL: '',
  CHATWOOT_ENABLED: 'false',
  TYPEBOT_ENABLED: 'false',
  DIFY_ENABLED: 'false',
  N8N_ENABLED: 'false',
  EVOAI_ENABLED: 'false',
  FLOWISE_ENABLED: 'false',
  S3_ENABLED: 'false',
  CACHE_REDIS_ENABLED: 'false',
  CACHE_REDIS_URI: '',
  CACHE_LOCAL_ENABLED: 'false',
  DATABASE_PROVIDER: 'postgresql',
  DATABASE_SAVE_DATA_NEW_MESSAGE: 'true',
  WEBHOOK_GLOBAL_ENABLED: 'false',
  RABBITMQ_ENABLED: 'false',
  SQS_ENABLED: 'false',
  NATS_ENABLED: 'false',
  PUSHER_ENABLED: 'false',
  KAFKA_ENABLED: 'false',
  WEBSOCKET_ENABLED: 'false',
  SENTRY_DSN: '',
  LANGUAGE: 'pt-BR',
};

for (const [key, value] of Object.entries(env)) process.env[key] = value;

// Prisma reads DATABASE_CONNECTION_URI. Only the disposable test database may ever be used: a production URI
// coming from a local `.env` must never be picked up by the tests.
process.env.DATABASE_CONNECTION_URI = process.env.TEST_DATABASE_URL || 'postgresql://invalid-host.test:1/none';

/** Anything the code under test reads from server.module and the tests do not care about. */
const deep = (): any =>
  new Proxy(function () {}, {
    get: (_target, prop) => (prop === 'then' ? undefined : prop === Symbol.toPrimitive ? () => '' : deep()),
    apply: () => deep(),
    construct: () => deep(),
  });

const serverModuleStub: Record<string | symbol, any> = new Proxy(
  {
    __esModule: true,
    chatbotController: {
      emit: recordChatbotEmit,
    },
  } as Record<string | symbol, any>,
  { get: (target, prop) => (prop in target ? target[prop] : deep()) },
);

const loader = Module as unknown as { _load: (...args: any[]) => any };
const originalLoad = loader._load;
loader._load = function (request: string, parent: any, isMain: boolean) {
  if (request === '@api/server.module' || /[\\/]src[\\/]api[\\/]server\.module(\.ts)?$/.test(request)) {
    return serverModuleStub;
  }
  return originalLoad.call(this, request, parent, isMain);
};
