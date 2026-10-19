import Fastify, { LogController, type FastifyBaseLogger } from 'fastify';
import pino from 'pino';
import { randomUUID } from 'node:crypto';
import type { Config } from './config/env.js';
import { installAuth } from './middleware/auth.js';
import { otpRoutes } from './routes/otp.js';
import { Metrics } from './services/metrics.js';
import { RedisStore } from './services/redis-store.js';
import type { Store } from './services/types.js';
import { Waiters } from './services/waiters.js';
import { HttpError } from './utils/errors.js';

export function buildApp(config: Config, options: { store?: Store; logger?: pino.Logger } = {}) {
  const logger = options.logger ?? pino({ level: config.logLevel,
    redact: ['req', 'res', 'body', 'headers', 'authorization', 'code', 'encrypted', 'token', 'key', 'redisUrl'],
  });
  const app = Fastify({
    loggerInstance: logger as FastifyBaseLogger, logController: new LogController({ disableRequestLogging: true }), genReqId: () => randomUUID(),
    bodyLimit: 4096, requestTimeout: 10000, connectionTimeout: 35000, keepAliveTimeout: 5000,
    trustProxy: config.production ? (_address, hop) => hop === 0 : false,
    return503OnClosing: true, forceCloseConnections: true,
    routerOptions: { maxParamLength: 64 },
  });
  const store = options.store ?? new RedisStore(config.redisUrl, config.redisPrefix, logger);
  const metrics = new Metrics();
  const waiters = new Waiters(store, config.maxLongPolls);
  let draining = false;
  app.decorateRequest('startedAt', 0);
  app.decorateRequest('longPoll', false);
  app.addHook('onRequest', async (request, reply) => {
    request.startedAt = performance.now();
    reply.headers({ 'Cache-Control': 'no-store, private', Pragma: 'no-cache',
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      'X-Request-Id': request.id });
    if (config.production) reply.header('Strict-Transport-Security', 'max-age=31536000');
  });
  installAuth(app, config, store);
  app.addHook('onSend', async (request, reply) => {
    reply.header('Server-Timing', `app;dur=${(performance.now() - request.startedAt).toFixed(2)}`);
  });
  app.addHook('onResponse', async (request, reply) => {
    const durationMs = performance.now() - request.startedAt;
    const route = request.routeOptions.url ?? 'unmatched';
    metrics.record(route, request.routeOptions.method?.toString() ?? 'unknown', durationMs, reply.statusCode, request.longPoll);
    request.log.info({ event: 'request_complete', route, status: reply.statusCode, longPoll: request.longPoll,
      durationMs: Number(durationMs.toFixed(3)) }, 'Request complete');
  });
  app.setErrorHandler((caught, request, reply) => {
    const error = caught as Error & { code?: string; statusCode?: number };
    let status = error instanceof HttpError ? error.statusCode : 503;
    let message = error instanceof HttpError ? error.publicMessage : 'Service unavailable';
    if (error.code === 'FST_ERR_CTP_BODY_TOO_LARGE') { status = 413; message = 'Payload too large'; }
    else if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500 && !(error instanceof HttpError)) {
      status = error.statusCode; message = 'Invalid request';
    }
    if (status >= 500) request.log.error({ event: 'request_failed' }, 'Request failed');
    // No raw error, validation issues, URL, headers or body in logs or responses.
    void reply.code(status).send({ error: message, requestId: request.id });
  });
  app.setNotFoundHandler((_request, reply) => reply.code(404).send({ error: 'Not found' }));
  app.get('/health', async () => ({ status: 'ok', uptimeSeconds: Math.floor(process.uptime()) }));
  app.get('/ready', async (_request, reply) => {
    const ready = !draining && await store.ready();
    return reply.code(ready ? 200 : 503).send({ status: ready ? 'ready' : 'unavailable' });
  });
  app.get('/api/v1/metrics', { config: { role: 'metrics' } }, async () => metrics.snapshot());
  otpRoutes(app, config, store, waiters);
  app.addHook('onReady', () => store.start());
  app.addHook('preClose', async () => { draining = true; waiters.close(); });
  app.addHook('onClose', () => store.close());
  return { app, store };
}
