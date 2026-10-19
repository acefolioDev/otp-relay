import { it, expect, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import type { Store } from '../src/services/types.js';
import { config, auth, credentials } from './helpers.js';

it('keeps liveness healthy but fails readiness and API safely when Redis is down', async () => {
  const store: Store = {
    start: vi.fn().mockResolvedValue(undefined), ready: vi.fn().mockResolvedValue(false),
    limit: vi.fn().mockRejectedValue(new Error('redis://SECRET:password@redis')),
    put: vi.fn(), latest: vi.fn(), consume: vi.fn(), onChange: () => () => {}, close: vi.fn(),
  };
  const { app } = buildApp(config(), { store });
  try {
    expect((await app.inject('/health')).statusCode).toBe(200);
    expect((await app.inject('/ready')).statusCode).toBe(503);
    const response = await app.inject({ url: '/api/v1/otp/latest', headers: auth(credentials.iphone) });
    expect(response.statusCode).toBe(503); expect(response.body).not.toContain('SECRET');
  } finally { await app.close(); }
});
