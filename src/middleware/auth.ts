import type { FastifyInstance } from 'fastify';
import type { Config, Pair } from '../config/env.js';
import type { Store } from '../services/types.js';
import type { Database } from '../services/db.js';
import { digest, matchesHash } from '../utils/crypto.js';
import { HttpError } from '../utils/errors.js';

export type Role = 'android' | 'iphone' | 'metrics';
declare module 'fastify' {
  interface FastifyContextConfig { role?: Role }
  interface FastifyRequest { pair: Pair | null; startedAt: number; longPoll: boolean }
}

interface DevicePairRow {
  pair_id: string;
  key_id: string | null;
}

export function installAuth(app: FastifyInstance, config: Config, store: Store, db?: Database) {
  app.decorateRequest('pair', null);
  app.addHook('onRequest', async (request, reply) => {
    const role = request.routeOptions.config.role;
    if (!role) return;
    if (config.production && request.protocol !== 'https') throw new HttpError(426, 'HTTPS required');
    if (request.headers.origin) throw new HttpError(403, 'Browser origins are not supported');
    const header = request.headers.authorization ?? '';
    const token = /^Bearer [A-Za-z0-9_-]{43,128}$/.test(header) ? header.slice(7) : '';
    let valid = false;
    if (role === 'metrics') valid = matchesHash(token, config.metricsTokenHash);
    else {
      // Compare every configured hash, even after a match. Bound pair count in configuration.
      for (const pair of config.pairs) {
        const hashes = role === 'android' ? pair.androidTokenHashes : pair.iphoneTokenHashes;
        for (const hash of hashes) {
          const match = matchesHash(token, hash);
          if (match) { request.pair = pair; valid = true; }
        }
      }

      // Fall back to DB lookup when static config has no match and DB is available.
      if (!valid && token.length > 0 && db) {
        const tokenHash = digest(token);
        // Map middleware role to DB device_type value.
        const deviceType = role === 'android' ? 'android' : 'ios';
        const result = await db.query<DevicePairRow>(
          `SELECT dp.id AS pair_id, dp.key_id
           FROM devices d
           JOIN device_pairs dp
             ON (d.device_type = 'android' AND dp.android_device_id = d.id)
             OR (d.device_type = 'ios'     AND dp.ios_device_id     = d.id)
           WHERE d.auth_token_hash = $1
             AND d.device_type     = $2
             AND dp.status         = 'active'
           LIMIT 1`,
          [tokenHash, deviceType]
        );
        const dbRow = result.rows[0];
        if (dbRow) {
          // Build a synthetic Pair so OTP relay routes work unchanged.
          const syntheticPair: Pair = {
            pairId: dbRow.pair_id,
            androidTokenHashes: [],
            iphoneTokenHashes: [],
            keyIds: dbRow.key_id ? [dbRow.key_id] : [],
          };
          request.pair = syntheticPair;
          valid = true;
        }
      }
    }
    valid = valid && token.length > 0;
    const rateKey = valid ? `${request.pair?.pairId ?? 'metrics'}:${role}` : `unauthorized:${digest(request.ip)}`;
    const max = valid ? (role === 'android' ? config.androidRateLimit : role === 'iphone' ? config.iphoneRateLimit : 60) : 30;
    const result = await store.limit(rateKey, max, 60_000);
    if (!result.allowed) {
      reply.header('Retry-After', result.retryAfter);
      throw new HttpError(429, 'Too many requests');
    }
    if (!valid) {
      reply.header('WWW-Authenticate', 'Bearer');
      throw new HttpError(401, 'Unauthorized');
    }
  });
}
