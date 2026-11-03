import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomBytes, createHash, scryptSync, timingSafeEqual } from 'node:crypto';
import type { Database } from '../services/db.js';
import type { AuthService } from '../services/auth-service.js';
import { HttpError } from '../utils/errors.js';

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, key] = stored.split(':');
  if (!salt || !key) return false;
  const hash = scryptSync(password, salt, 64);
  const keyBuffer = Buffer.from(key, 'hex');
  if (hash.length !== keyBuffer.length) return false;
  return timingSafeEqual(hash, keyBuffer);
}

const registerSchema = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email().max(255),
  password: z.string().min(6).max(128),
  deviceName: z.string().min(1).max(100),
  deviceType: z.enum(['android', 'ios']),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  deviceName: z.string().min(1).max(100),
  deviceType: z.enum(['android', 'ios']),
});

const googleAuthSchema = z.object({
  idToken: z.string().min(10),
  deviceName: z.string().min(1).max(100),
  deviceType: z.enum(['android', 'ios']),
});

const pairInitiateSchema = z.object({
  deviceId: z.string().min(1).max(64),
  keyId: z.string().min(1).max(64),
  encryptionKey: z.string().min(30).max(128).optional(),
});

const pairCompleteSchema = z.object({
  pairCode: z.string().length(8),
  deviceId: z.string().min(1).max(64),
});

export function registerAuthRoutes(
  app: FastifyInstance,
  db: Database,
  authService: AuthService
) {
  // 1. Email & Password Registration
  app.post('/api/v1/auth/register', async (request, reply) => {
    const parse = registerSchema.safeParse(request.body);
    if (!parse.success) throw new HttpError(400, 'Invalid registration parameters');
    const { name, email, password, deviceName, deviceType } = parse.data;

    const existing = await db.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length > 0) throw new HttpError(409, 'An account with this email already exists');

    const pwHash = hashPassword(password);
    const userRes = await db.query(
      `INSERT INTO users (email, name, password_hash, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       RETURNING id, email, name`,
      [email.toLowerCase(), name, pwHash]
    );
    const user = userRes.rows[0];

    // Create Device Token
    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');

    const deviceRes = await db.query(
      `INSERT INTO devices (user_id, device_name, device_type, auth_token_hash, last_seen_at)
       VALUES ($1, $2, $3, $4, NOW())
       RETURNING id, device_name, device_type, created_at`,
      [user.id, deviceName, deviceType, tokenHash]
    );
    const device = deviceRes.rows[0];

    reply.status(201).send({
      user,
      device: {
        id: device.id,
        name: device.device_name,
        type: device.device_type,
        token: rawToken,
      },
    });
  });

  // 2. Email & Password Login
  app.post('/api/v1/auth/login', async (request, reply) => {
    const parse = loginSchema.safeParse(request.body);
    if (!parse.success) throw new HttpError(400, 'Invalid login credentials');
    const { email, password, deviceName, deviceType } = parse.data;

    const userRes = await db.query('SELECT id, email, name, password_hash FROM users WHERE email = $1', [email.toLowerCase()]);
    if (userRes.rows.length === 0 || !userRes.rows[0].password_hash) {
      throw new HttpError(401, 'Invalid email or password');
    }
    const user = userRes.rows[0];
    if (!verifyPassword(password, user.password_hash)) {
      throw new HttpError(401, 'Invalid email or password');
    }

    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');

    const deviceRes = await db.query(
      `INSERT INTO devices (user_id, device_name, device_type, auth_token_hash, last_seen_at)
       VALUES ($1, $2, $3, $4, NOW())
       RETURNING id, device_name, device_type, created_at`,
      [user.id, deviceName, deviceType, tokenHash]
    );
    const device = deviceRes.rows[0];

    reply.status(200).send({
      user: { id: user.id, email: user.email, name: user.name },
      device: {
        id: device.id,
        name: device.device_name,
        type: device.device_type,
        token: rawToken,
      },
    });
  });

  // 3. Optional: Sign in / Register with Google (from Android or iOS)
  app.post('/api/v1/auth/google', async (request, reply) => {
    const parse = googleAuthSchema.safeParse(request.body);
    if (!parse.success) throw new HttpError(400, 'Invalid Google auth request parameters');

    const { idToken, deviceName, deviceType } = parse.data;
    const profile = await authService.verifyGoogleIdToken(idToken);

    // Upsert User
    const userRes = await db.query(
      `INSERT INTO users (email, google_sub, name, picture, updated_at)
       VALUES ($1, $2, $3, $4, NOW())
       ON CONFLICT (email) DO UPDATE 
       SET google_sub = COALESCE(users.google_sub, EXCLUDED.google_sub),
           name = COALESCE(EXCLUDED.name, users.name),
           picture = COALESCE(EXCLUDED.picture, users.picture),
           updated_at = NOW()
       RETURNING id, email, name, picture`,
      [profile.email, profile.sub, profile.name, profile.picture]
    );
    const user = userRes.rows[0];

    // Generate new Device API Token
    const rawToken = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');

    const deviceRes = await db.query(
      `INSERT INTO devices (user_id, device_name, device_type, auth_token_hash, last_seen_at)
       VALUES ($1, $2, $3, $4, NOW())
       RETURNING id, device_name, device_type, created_at`,
      [user.id, deviceName, deviceType, tokenHash]
    );
    const device = deviceRes.rows[0];

    reply.status(200).send({
      user,
      device: {
        id: device.id,
        name: device.device_name,
        type: device.device_type,
        token: rawToken, // Delivered once to the registering client
      },
    });
  });

  // 2. Initiate Device Pairing (e.g., Android generates pair code or QR payload)
  app.post('/api/v1/devices/pair/initiate', async (request, reply) => {
    // Require the calling device to authenticate with its Bearer token.
    const authHeader = request.headers.authorization ?? '';
    const callerToken = /^Bearer [A-Za-z0-9_-]{43,128}$/.test(authHeader) ? authHeader.slice(7) : '';
    if (!callerToken) {
      reply.header('WWW-Authenticate', 'Bearer');
      throw new HttpError(401, 'Unauthorized');
    }
    const callerTokenHash = createHash('sha256').update(callerToken).digest('hex');

    const parse = pairInitiateSchema.safeParse(request.body);
    if (!parse.success) throw new HttpError(400, 'Invalid initiate parameters');
    const { deviceId, keyId, encryptionKey } = parse.data;

    // Verify device exists and belongs to the authenticated caller.
    const deviceRes = await db.query('SELECT id, user_id, device_type, auth_token_hash FROM devices WHERE id = $1', [deviceId]);
    if (deviceRes.rows.length === 0) throw new HttpError(404, 'Device not found');
    const device = deviceRes.rows[0];

    // Confirm the caller's token matches the device being paired.
    if (device.auth_token_hash !== callerTokenHash) throw new HttpError(403, 'Token does not match the specified device');

    // Generate readable 8-char uppercase pair code
    const pairCode = randomBytes(4).toString('hex').toUpperCase();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 mins

    const pairRes = await db.query(
      `INSERT INTO device_pairs (user_id, pair_code, android_device_id, key_id, encryption_key, expires_at, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending')
       RETURNING id, pair_code, expires_at`,
      [device.user_id, pairCode, device.device_type === 'android' ? deviceId : null, keyId, encryptionKey || null, expiresAt]
    );

    reply.status(201).send({
      pairId: pairRes.rows[0].id,
      pairCode: pairRes.rows[0].pair_code,
      expiresAt: pairRes.rows[0].expires_at,
    });
  });

  // 3. Complete Device Pairing (e.g., iOS scans QR code or enters pair code)
  app.post('/api/v1/devices/pair/complete', async (request, reply) => {
    // Require the calling device to authenticate with its Bearer token.
    const authHeader = request.headers.authorization ?? '';
    const callerToken = /^Bearer [A-Za-z0-9_-]{43,128}$/.test(authHeader) ? authHeader.slice(7) : '';
    if (!callerToken) {
      reply.header('WWW-Authenticate', 'Bearer');
      throw new HttpError(401, 'Unauthorized');
    }
    const callerTokenHash = createHash('sha256').update(callerToken).digest('hex');

    const parse = pairCompleteSchema.safeParse(request.body);
    if (!parse.success) throw new HttpError(400, 'Invalid complete parameters');
    const { pairCode, deviceId } = parse.data;

    const deviceRes = await db.query('SELECT id, user_id, device_type, auth_token_hash FROM devices WHERE id = $1', [deviceId]);
    if (deviceRes.rows.length === 0) throw new HttpError(404, 'Device not found');
    const device = deviceRes.rows[0];

    // Confirm the caller's token matches the device being paired.
    if (device.auth_token_hash !== callerTokenHash) throw new HttpError(403, 'Token does not match the specified device');

    const pairRes = await db.query(
      `SELECT id, user_id, key_id, encryption_key, status, expires_at FROM device_pairs WHERE pair_code = $1`,
      [pairCode]
    );
    if (pairRes.rows.length === 0) throw new HttpError(404, 'Invalid pair code');
    const pair = pairRes.rows[0];

    if (pair.user_id !== device.user_id) throw new HttpError(403, 'Pair code belongs to another user');
    if (pair.status !== 'pending') throw new HttpError(400, 'Pair code already used or revoked');
    if (new Date(pair.expires_at).getTime() < Date.now()) throw new HttpError(410, 'Pair code expired');

    // Update pair
    await db.query(
      `UPDATE device_pairs 
       SET ios_device_id = $1, status = 'active', updated_at = NOW()
       WHERE id = $2`,
      [deviceId, pair.id]
    );

    reply.status(200).send({
      message: 'Pairing complete and verified',
      pairId: pair.id,
      status: 'active',
      pairing: {
        role: 'iphone',
        pairId: pair.id,
        token: callerToken,
        keyId: pair.key_id,
        encryptionKey: pair.encryption_key,
      },
    });
  });
}
