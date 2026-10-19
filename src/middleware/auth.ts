import type { FastifyInstance } from 'fastify';
import type { Config, Pair } from '../config/env.js';
import type { Store } from '../services/types.js';
import { digest, matchesHash } from '../utils/crypto.js';
import { HttpError } from '../utils/errors.js';

export type Role = 'android' | 'iphone' | 'metrics';
declare module 'fastify' {
  interface FastifyContextConfig { role?: Role }
  interface FastifyRequest { pair: Pair | null; startedAt: number; longPoll: boolean }
}
export function installAuth(app: FastifyInstance, config: Config, store: Store) {
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
