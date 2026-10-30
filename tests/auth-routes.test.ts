import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { registerAuthRoutes } from '../src/routes/auth.js';
import type { Database } from '../src/services/db.js';
import type { AuthService } from '../src/services/auth-service.js';

describe('Auth & Device Pairing Routes', () => {
  it('registers a user with name, email and password', async () => {
    const mockDb: Database = {
      query: vi.fn().mockImplementation(async (sql: string, params: any[]) => {
        if (sql.includes('SELECT id FROM users WHERE email')) {
          return { rows: [] };
        }
        if (sql.includes('INSERT INTO users')) {
          return { rows: [{ id: 'user-uuid-1', email: params[0], name: params[1] }] };
        }
        if (sql.includes('INSERT INTO devices')) {
          return { rows: [{ id: 'device-uuid-1', device_name: params[1], device_type: params[2] }] };
        }
        return { rows: [] };
      }),
      close: vi.fn(),
      migrate: vi.fn(),
    };

    const app = Fastify();
    registerAuthRoutes(app, mockDb, {} as any);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        name: 'Muhammad Atif',
        email: 'atif@example.com',
        password: 'SuperSecretPassword123!',
        deviceName: "Atif's iPhone 14",
        deviceType: 'ios',
      },
    });

    expect(res.statusCode).toBe(201);
    const body = JSON.parse(res.body);
    expect(body.user.email).toBe('atif@example.com');
    expect(body.user.name).toBe('Muhammad Atif');
    expect(body.device.token).toBeDefined();
    expect(body.device.token.length).toBeGreaterThan(30);
  });

  it('authenticates user with email and password', async () => {
    // Generate valid scrypt hash
    const { scryptSync } = await import('node:crypto');
    const salt = 'aabbccddeeff';
    const hash = scryptSync('SuperSecretPassword123!', salt, 64).toString('hex');
    const storedHash = `${salt}:${hash}`;

    const mockDb: Database = {
      query: vi.fn().mockImplementation(async (sql: string) => {
        if (sql.includes('SELECT id, email, name, password_hash FROM users')) {
          return { rows: [{ id: 'user-uuid-1', email: 'atif@example.com', name: 'Muhammad Atif', password_hash: storedHash }] };
        }
        if (sql.includes('INSERT INTO devices')) {
          return { rows: [{ id: 'device-uuid-1', device_name: 'iPhone 14', device_type: 'ios' }] };
        }
        return { rows: [] };
      }),
      close: vi.fn(),
      migrate: vi.fn(),
    };

    const app = Fastify();
    registerAuthRoutes(app, mockDb, {} as any);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: {
        email: 'atif@example.com',
        password: 'SuperSecretPassword123!',
        deviceName: 'iPhone 14',
        deviceType: 'ios',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.user.name).toBe('Muhammad Atif');
    expect(body.device.token).toBeDefined();
  });
});
