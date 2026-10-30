import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomBytes, createHash } from 'node:crypto';
import type { Database } from '../services/db.js';
import type { AuthService } from '../services/auth-service.js';
import { HttpError } from '../utils/errors.js';

const googleAuthSchema = z.object({
  idToken: z.string().min(10),
  deviceName: z.string().min(1).max(100),
  deviceType: z.enum(['android', 'ios']),
});

const pairInitiateSchema = z.object({
  deviceId: z.string().min(1).max(64),
  keyId: z.string().min(1).max(64),
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
  // 1. Sign in / Register with Google (from Android or iOS)
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
    const parse = pairInitiateSchema.safeParse(request.body);
    if (!parse.success) throw new HttpError(400, 'Invalid initiate parameters');
    const { deviceId, keyId } = parse.data;

    // Verify device
    const deviceRes = await db.query('SELECT user_id, device_type FROM devices WHERE id = $1', [deviceId]);
    if (deviceRes.rows.length === 0) throw new HttpError(404, 'Device not found');
    const device = deviceRes.rows[0];

    // Generate readable 8-char uppercase pair code
    const pairCode = randomBytes(4).toString('hex').toUpperCase();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 mins

    const pairRes = await db.query(
      `INSERT INTO device_pairs (user_id, pair_code, android_device_id, key_id, expires_at, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')
       RETURNING id, pair_code, expires_at`,
      [device.user_id, pairCode, device.device_type === 'android' ? deviceId : null, keyId, expiresAt]
    );

    reply.status(201).send({
      pairId: pairRes.rows[0].id,
      pairCode: pairRes.rows[0].pair_code,
      expiresAt: pairRes.rows[0].expires_at,
    });
  });

  // 3. Complete Device Pairing (e.g., iOS scans QR code or enters pair code)
  app.post('/api/v1/devices/pair/complete', async (request, reply) => {
    const parse = pairCompleteSchema.safeParse(request.body);
    if (!parse.success) throw new HttpError(400, 'Invalid complete parameters');
    const { pairCode, deviceId } = parse.data;

    const deviceRes = await db.query('SELECT user_id, device_type FROM devices WHERE id = $1', [deviceId]);
    if (deviceRes.rows.length === 0) throw new HttpError(404, 'Device not found');
    const device = deviceRes.rows[0];

    const pairRes = await db.query(
      `SELECT id, user_id, status, expires_at FROM device_pairs WHERE pair_code = $1`,
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
    });
  });
}
