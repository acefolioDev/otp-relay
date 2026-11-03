import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { Config } from '../config/env.js';
import type { Store, Upload } from '../services/types.js';
import type { Waiters } from '../services/waiters.js';
import { HttpError } from '../utils/errors.js';

const b64 = (bytes: number) => z.string().refine(v => /^[A-Za-z0-9_-]+$/.test(v)
  && Buffer.from(v, 'base64url').length === bytes && Buffer.from(v, 'base64url').toString('base64url') === v);
const base = {
  messageId: z.uuid().transform(v => v.toLowerCase()), source: z.literal('android'),
  receivedAt: z.iso.datetime({ precision: 3 }),
};
const encrypted = z.object({ ...base, encrypted: z.object({
  algorithm: z.literal('A256GCM'), keyId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  nonce: b64(12), tag: b64(16),
  // AES-GCM preserves the encrypted SMS body length (up to 1024 UTF-8 bytes).
  ciphertext: z.string().min(2).max(1366).refine(v => /^[A-Za-z0-9_-]+$/.test(v)
    && Buffer.from(v, 'base64url').length >= 1 && Buffer.from(v, 'base64url').length <= 1024
    && Buffer.from(v, 'base64url').toString('base64url') === v),
}).strict() }).strict();
const plaintext = z.object({ ...base, code: z.string().min(1).max(1024) }).strict();
const query = z.object({
  waitSeconds: z.coerce.number().int().min(0).max(25).default(0),
  afterId: z.uuid().transform(v => v.toLowerCase()).optional(),
}).strict();
const noQuery = z.object({}).strict();
export function otpRoutes(app: FastifyInstance, config: Config, store: Store, waiters: Waiters) {
  app.post('/api/v1/otp', { config: { role: 'android' } }, async (request, reply) => {
    const body = (config.allowPlaintext ? z.union([encrypted, plaintext]) : encrypted).safeParse(request.body);
    if (!body.success || !noQuery.safeParse(request.query).success) throw new HttpError(422, 'Invalid OTP payload');
    const upload: Upload = body.data;
    if (upload.encrypted && !request.pair!.keyIds.includes(upload.encrypted.keyId)) {
      throw new HttpError(422, 'Unknown encryption key ID');
    }
    const result = await store.put(request.pair!.pairId, upload, config.ttlMs, config.clockSkewMs);
    request.log.info({ event: 'otp_ingested', duplicate: result.duplicate,
      clientToServerMs: Date.now() - Date.parse(upload.receivedAt) }, 'Upload processed');
    return reply.code(result.duplicate ? 200 : 201).send({ success: true, messageId: upload.messageId, ...result });
  });
  app.get('/api/v1/otp/latest', { config: { role: 'iphone' } }, async (request, reply) => {
    const parsed = query.safeParse(request.query);
    if (!parsed.success) throw new HttpError(422, 'Invalid query');
    const { waitSeconds, afterId } = parsed.data;
    request.longPoll = waitSeconds > 0;
    const pairId = request.pair!.pairId;
    if (!waitSeconds) {
      const otp = await store.latest(pairId);
      return otp ? { available: true, otp } : {
        available: false,
        reason: 'no_message_available',
        message: 'No message is currently stored for this pairing. Android has not uploaded one, or the previous message expired or was consumed.',
      };
    }
    const release = waiters.acquire(pairId);
    const controller = new AbortController();
    const abort = () => controller.abort();
    reply.raw.once('close', abort);
    const end = performance.now() + waitSeconds * 1000;
    try {
      while (!controller.signal.aborted && !waiters.closed) {
        const listener = waiters.listen(pairId, controller.signal, end - performance.now());
        try {
          const otp = await store.latest(pairId);
          if (otp && otp.id !== afterId) return { available: true, otp };
          if (performance.now() >= end) return {
            available: false,
            reason: afterId ? 'no_new_message' : 'no_message_available',
            message: afterId
              ? 'No newer message arrived during the wait period.'
              : 'No message is currently stored for this pairing. Android has not uploaded one, or the previous message expired or was consumed.',
          };
          await listener.promise;
          if (performance.now() >= end) {
            // Final read closes the upload-at-timeout race.
            const latest = await store.latest(pairId);
            return latest && latest.id !== afterId ? { available: true, otp: latest } : {
              available: false,
              reason: afterId ? 'no_new_message' : 'no_message_available',
              message: afterId
                ? 'No newer message arrived during the wait period.'
                : 'No message is currently stored for this pairing. Android has not uploaded one, or the previous message expired or was consumed.',
            };
          }
        } finally { listener.cancel(); }
      }
      if (waiters.closed) throw new HttpError(503, 'Service unavailable');
      return {
        available: false,
        reason: afterId ? 'no_new_message' : 'no_message_available',
        message: afterId
          ? 'No newer message arrived during the wait period.'
          : 'No message is currently stored for this pairing. Android has not uploaded one, or the previous message expired or was consumed.',
      };
    } finally { reply.raw.off('close', abort); release(); }
  });
  app.post('/api/v1/otp/:id/consume', { config: { role: 'iphone' } }, async (request, reply) => {
    const params = z.object({ id: z.uuid().transform(v => v.toLowerCase()) }).strict().safeParse(request.params);
    if (!params.success || request.body !== undefined || !noQuery.safeParse(request.query).success) {
      throw new HttpError(422, 'Invalid consumption request');
    }
    if (!await store.consume(request.pair!.pairId, params.data.id)) throw new HttpError(404, 'OTP unavailable');
    return reply.code(204).send();
  });
}
