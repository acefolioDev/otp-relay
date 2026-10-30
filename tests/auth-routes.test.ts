import { describe, it, expect, vi } from 'vitest';
import Fastify from 'fastify';
import { registerAuthRoutes } from '../src/routes/auth.js';
import type { Database } from '../src/services/db.js';
import type { AuthService } from '../src/services/auth-service.js';

describe('Auth & Device Pairing Routes', () => {
  it('registers user and issues device token upon valid Google ID token', async () => {
    const mockDb: Database = {
      query: vi.fn().mockImplementation(async (sql: string, params: any[]) => {
        if (sql.includes('INSERT INTO users')) {
          return { rows: [{ id: '11111111-1111-1111-1111-111111111111', email: params[0], name: params[2], picture: params[3] }] };
        }
        if (sql.includes('INSERT INTO devices')) {
          return { rows: [{ id: '22222222-2222-2222-2222-222222222222', device_name: params[1], device_type: params[2] }] };
        }
        return { rows: [] };
      }),
      close: vi.fn(),
      migrate: vi.fn(),
    };

    const mockAuthService: AuthService = {
      verifyGoogleIdToken: vi.fn().mockResolvedValue({
        sub: 'google-sub-12345',
        email: 'user@gmail.com',
        name: 'Test User',
        picture: 'https://example.com/avatar.png',
      }),
    } as any;

    const app = Fastify();
    registerAuthRoutes(app, mockDb, mockAuthService);

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/google',
      payload: {
        idToken: 'mock-valid-id-token-abc',
        deviceName: "User's Pixel 9",
        deviceType: 'android',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.user.email).toBe('user@gmail.com');
    expect(body.device.name).toBe("User's Pixel 9");
    expect(body.device.token).toBeDefined();
    expect(body.device.token.length).toBeGreaterThan(30);
  });

  it('initiates and completes pairing across Android and iOS', async () => {
    const mockDb: Database = {
      query: vi.fn().mockImplementation(async (sql: string, params: any[]) => {
        if (sql.includes('SELECT user_id, device_type FROM devices')) {
          return { rows: [{ user_id: '11111111-1111-1111-1111-111111111111', device_type: 'android' }] };
        }
        if (sql.includes('INSERT INTO device_pairs')) {
          return { rows: [{ id: 'pair-uuid-1', pair_code: params[1], expires_at: params[4] }] };
        }
        if (sql.includes('SELECT id, user_id, status, expires_at FROM device_pairs')) {
          return { rows: [{ id: 'pair-uuid-1', user_id: '11111111-1111-1111-1111-111111111111', status: 'pending', expires_at: new Date(Date.now() + 60000) }] };
        }
        if (sql.includes('UPDATE device_pairs')) {
          return { rows: [] };
        }
        return { rows: [] };
      }),
      close: vi.fn(),
      migrate: vi.fn(),
    };

    const mockAuthService = {} as any;
    const app = Fastify();
    registerAuthRoutes(app, mockDb, mockAuthService);

    // Initiate pairing
    const initRes = await app.inject({
      method: 'POST',
      url: '/api/v1/devices/pair/initiate',
      payload: {
        deviceId: '22222222-2222-2222-2222-222222222222',
        keyId: 'key-test-123',
      },
    });
    expect(initRes.statusCode).toBe(201);
    const initBody = JSON.parse(initRes.body);
    expect(initBody.pairCode).toBeDefined();

    // Complete pairing with iOS
    const completeRes = await app.inject({
      method: 'POST',
      url: '/api/v1/devices/pair/complete',
      payload: {
        pairCode: initBody.pairCode,
        deviceId: '33333333-3333-3333-3333-333333333333',
      },
    });
    expect(completeRes.statusCode).toBe(200);
    const completeBody = JSON.parse(completeRes.body);
    expect(completeBody.status).toBe('active');
  });
});
