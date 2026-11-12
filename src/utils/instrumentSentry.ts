import { configService, Sentry as SentryConfig } from '@config/env.config';
import * as Sentry from '@sentry/node';

const sentryConfig = configService.get<SentryConfig>('SENTRY');

if (sentryConfig.DSN) {
  Sentry.init({
    dsn: sentryConfig.DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: 1.0,
    profileSessionSampleRate: 1.0,
    profileLifecycle: 'trace',
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
    },
  });
}
