import { beforeEach, afterEach, describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import pino from 'pino';
import { createClient } from 'redis';
import { setTimeout as delay } from 'node:timers/promises';
import { buildApp } from '../src/app.js';
import { RedisStore } from '../src/services/redis-store.js';
import { config, credentials as c, auth, upload, decrypt, pairId, otherPairId } from './helpers.js';
import { digest } from '../src/utils/crypto.js';

if (process.env.REQUIRE_REDIS_TESTS === 'true' && !process.env.TEST_REDIS_URL) throw new Error('Set TEST_REDIS_URL for required Redis integration tests');
const suite = process.env.TEST_REDIS_URL ? describe : describe.skip;
suite('real Redis API integration', () => {
  let service: ReturnType<typeof buildApp>;
  let cfg: ReturnType<typeof config>;
  let logs: string;
  const post = (payload: unknown, token = c.android) => service.app.inject({ method: 'POST', url: '/api/v1/otp', headers: { ...auth(token), 'content-type': 'application/json' }, payload: JSON.stringify(payload) });
  const latest = (token = c.iphone) => service.app.inject({ url: '/api/v1/otp/latest', headers: auth(token) });
  const consume = (id: string, token = c.iphone) => service.app.inject({ method: 'POST', url: `/api/v1/otp/${id}/consume`, headers: auth(token) });
  beforeEach(async () => {
    cfg = config(); logs = '';
    const logger = pino({ level: 'info' }, new Writable({ write(chunk, _enc, done) { logs += chunk.toString(); done(); } }));
    service = buildApp(cfg, { logger }); await service.app.ready();
  });
  afterEach(async () => {
    await service.app.close();
    const client = createClient({ url: cfg.redisUrl }); await client.connect();
    try {
      // Only the test's random namespace; never FLUSHDB on a shared Redis instance.
      for await (const keys of client.scanIterator({ MATCH: `${cfg.redisPrefix}:*`, COUNT: 100 })) if (keys.length) await client.del(keys);
    } finally { client.destroy(); }
  });
  it('uploads ciphertext, fetches without consuming, preserves mixed case through decryption', async () => {
    const body = upload(); const response = await post(body);
    expect(response.statusCode).toBe(201); expect(response.json()).toMatchObject({ success: true, duplicate: false });
    const first = await latest(); expect(first.statusCode).toBe(200); expect(first.headers['cache-control']).toContain('no-store');
    expect(first.json().otp.code).toBeUndefined(); expect(decrypt(first.json().otp)).toBe('Ab7Cd9Ef2G');
    expect(Date.parse(first.json().otp.expiresAt)).toBeGreaterThan(Date.now());
    expect((await latest()).json().otp).toEqual(first.json().otp);
    expect(first.headers['server-timing']).toMatch(/^app;dur=/);
  });
  it('supports numeric and 32-character encrypted codes without conversion', async () => {
    for (const code of ['001234', 'Ab7Cd9Ef2G', 'A'.repeat(32)]) {
      expect((await post(upload({ code }))).statusCode).toBe(201);
      expect(decrypt((await latest()).json().otp)).toBe(code);
    }
  });
  it('rejects invalid, missing and wrong-role credentials', async () => {
    expect((await latest('x'.repeat(43))).statusCode).toBe(401);
    expect((await latest(c.android)).statusCode).toBe(401);
    expect((await post(upload(), c.iphone)).statusCode).toBe(401);
    expect((await service.app.inject('/api/v1/otp/latest')).statusCode).toBe(401);
    expect((await service.app.inject({ url: '/api/v1/metrics', headers: auth(c.iphone) })).statusCode).toBe(401);
  });
  it('expires both ciphertext and retrieval access', async () => {
    // Redis TIME-based expiry: the message has only 150ms remaining.
    const body = upload({ receivedAt: new Date(Date.now() - cfg.ttlMs + 150).toISOString() });
    expect((await post(body)).statusCode).toBe(201);
    await delay(200); expect((await latest()).json()).toEqual({ available: false });
    expect((await consume(body.messageId)).statusCode).toBe(404);
  });
  it('deduplicates retries without extending TTL or publishing another event', async () => {
    const body = upload(); let changes = 0; const off = service.store.onChange(() => changes++);
    expect((await post(body)).statusCode).toBe(201);
    const expiresAt = (await latest()).json().otp.expiresAt;
    const second = await post(body); expect(second.statusCode).toBe(200); expect(second.json().duplicate).toBe(true);
    expect((await latest()).json().otp.expiresAt).toBe(expiresAt);
    await delay(20); off(); expect(changes).toBe(1);
  });
  it('rejects altered reuse of a message ID and nonce reuse under a new ID', async () => {
    const body = upload(); await post(body);
    expect((await post({ ...body, receivedAt: new Date(Date.now() + 1).toISOString() })).statusCode).toBe(409);
    expect((await post({ ...body, messageId: randomUUID() })).statusCode).toBe(409);
  });
  it('rejects expired and far-future replay timestamps', async () => {
    expect((await post(upload({ receivedAt: new Date(Date.now() - 91000).toISOString() }))).statusCode).toBe(422);
    expect((await post(upload({ receivedAt: new Date(Date.now() + 60000).toISOString() }))).statusCode).toBe(422);
  });
  it('does not replace a newer OTP with a delayed old upload', async () => {
    const current = upload(); await post(current);
    expect((await post(upload({ receivedAt: new Date(Date.now() - 2000).toISOString() }))).statusCode).toBe(409);
    expect((await latest()).json().otp.id).toBe(current.messageId);
  });
  it('atomically consumes and safely repeats consumption and upload', async () => {
    const body = upload(); await post(body);
    const responses = await Promise.all(Array.from({ length: 20 }, () => consume(body.messageId)));
    expect(responses.every(r => r.statusCode === 204)).toBe(true);
    expect((await latest()).json()).toEqual({ available: false });
    expect((await post(body)).json().duplicate).toBe(true);
    expect((await latest()).json()).toEqual({ available: false });
  });
  it('old consumption cannot delete a replacement OTP', async () => {
    const old = upload(); await post(old); await delay(2); const current = upload(); await post(current);
    expect((await consume(old.messageId)).statusCode).toBe(404);
    expect((await latest()).json().otp.id).toBe(current.messageId);
  });
  it('isolates pairs for upload, retrieval, consumption and deduplication', async () => {
    const body = upload(); await post(body);
    expect((await latest(c.otherIphone)).json()).toEqual({ available: false });
    expect((await consume(body.messageId, c.otherIphone)).statusCode).toBe(404);
    const other = upload({ pair: otherPairId }); await post(other, c.otherAndroid);
    expect((await latest()).json().otp.id).toBe(body.messageId);
    expect(decrypt((await latest(c.otherIphone)).json().otp, otherPairId)).toBe('Ab7Cd9Ef2G');
  });
  it('deduplicates simultaneous uploads', async () => {
    const body = upload(); const responses = await Promise.all(Array.from({ length: 20 }, () => post(body)));
    expect(responses.filter(r => r.statusCode === 201)).toHaveLength(1);
    expect(responses.filter(r => r.statusCode === 200)).toHaveLength(19);
  });
  it('serializes retrieval with consumption without partial values', async () => {
    const body = upload(); await post(body);
    const [reads] = await Promise.all([Promise.all(Array.from({ length: 20 }, () => latest())), consume(body.messageId)]);
    for (const read of reads) {
      expect(read.statusCode).toBe(200);
      if (read.json().available) expect(decrypt(read.json().otp)).toBe('Ab7Cd9Ef2G');
    }
    expect((await latest()).json()).toEqual({ available: false });
  });
  it('rejects plaintext, unknown fields, malformed envelopes and large bodies', async () => {
    const body = upload();
    for (const invalid of [null, {}, { ...body, code: '123456' }, { ...body, source: 'ios' },
      { ...body, messageId: 'bad' }, { ...body, extra: 'x' },
      { ...body, encrypted: { ...body.encrypted, keyId: 'unknown' } },
      { ...body, encrypted: { ...body.encrypted, nonce: 'AAAA' } },
      { ...body, encrypted: { ...body.encrypted, tag: 'invalid' } }]) {
      expect((await post(invalid)).statusCode).toBe(422);
    }
    expect((await post({ ...body, padding: 'a'.repeat(5000) })).statusCode).toBe(413);
    expect((await service.app.inject({ method: 'POST', url: '/api/v1/otp', headers: { ...auth(c.android), 'content-type': 'application/json' }, payload: '{broken' })).statusCode).toBe(400);
  });
  it('validates queries and consumption IDs', async () => {
    for (const suffix of ['?waitSeconds=26', '?waitSeconds=-1', '?afterId=x', '?token=SECRET']) {
      expect((await service.app.inject({ url: `/api/v1/otp/latest${suffix}`, headers: auth(c.iphone) })).statusCode).toBe(422);
    }
    expect((await consume('bad')).statusCode).toBe(422);
    expect((await consume(randomUUID())).statusCode).toBe(404);
  });
  it('keeps logs free of OTPs, credentials, bodies and arbitrary URLs', async () => {
    const body = upload(); await post(body);
    await post({ code: 'SensitiveDummyOTP' });
    await service.app.inject({ url: '/unknown?code=URL_SECRET', headers: { ...auth(c.iphone), 'x-request-id': 'SECRET_REQUEST_ID' } });
    await latest();
    for (const secret of [c.android, c.iphone, 'Ab7Cd9Ef2G', 'SensitiveDummyOTP', body.encrypted!.ciphertext, 'URL_SECRET', 'SECRET_REQUEST_ID']) {
      expect(logs).not.toContain(secret);
    }
    expect(logs).toContain('durationMs');
  });
  it('wakes a pending long poll on upload', async () => {
    const pending = service.app.inject({ url: '/api/v1/otp/latest?waitSeconds=2', headers: auth(c.iphone) });
    const promise = pending.then(r => r); await delay(30); const body = upload(); await post(body);
    expect((await promise).json().otp.id).toBe(body.messageId);
  });
  it('times out long polling and excludes the already seen ID', async () => {
    const body = upload(); await post(body);
    const response = await service.app.inject({ url: `/api/v1/otp/latest?waitSeconds=1&afterId=${body.messageId}`, headers: auth(c.iphone) });
    expect(response.json()).toEqual({ available: false });
    expect((await latest()).json().available).toBe(true);
  });
  it('bounds concurrent long polls and drains them on shutdown', async () => {
    const url = '/api/v1/otp/latest?waitSeconds=25';
    const a = service.app.inject({ url, headers: auth(c.iphone) }).then(r => r);
    const b = service.app.inject({ url, headers: auth(c.iphone) }).then(r => r);
    await delay(30);
    expect((await service.app.inject({ url, headers: auth(c.iphone) })).statusCode).toBe(429);
    await service.app.close();
    expect((await a).statusCode).toBe(503); expect((await b).statusCode).toBe(503);
  });
  it('delivers wakeups across backend instances using Redis Pub/Sub', async () => {
    const second = buildApp(cfg); await second.app.ready();
    try {
      const pending = second.app.inject({ url: '/api/v1/otp/latest?waitSeconds=2', headers: auth(c.iphone) }).then(r => r);
      await delay(20); const body = upload(); await post(body);
      expect((await pending).json().otp.id).toBe(body.messageId);
    } finally { await second.app.close(); }
  });
  it('shares rate limits across instances', async () => {
    const first = await service.store.limit('shared', 1, 1000); expect(first.allowed).toBe(true);
    const second = new RedisStore(cfg.redisUrl, cfg.redisPrefix, pino({ level: 'silent' })); await second.start();
    try { expect((await second.limit('shared', 1, 1000)).allowed).toBe(false); }
    finally { await second.close(); }
  });
  it('applies API rate limiting with retry-after', async () => {
    for (let i = 0; i < cfg.androidRateLimit; i++) await service.store.limit(`${pairId}:android`, cfg.androidRateLimit, 60000);
    const response = await post(upload()); expect(response.statusCode).toBe(429);
    expect(Number(response.headers['retry-after'])).toBeGreaterThan(0);
  });
  it('enforces HTTPS and rejects browser origins', async () => {
    const production = buildApp({ ...cfg, production: true }); await production.app.ready();
    try {
      expect((await production.app.inject({ url: '/api/v1/otp/latest', headers: auth(c.iphone) })).statusCode).toBe(426);
      expect((await production.app.inject({ url: '/api/v1/otp/latest', headers: { ...auth(c.iphone), 'x-forwarded-proto': 'https' } })).statusCode).toBe(200);
    } finally { await production.app.close(); }
    expect((await service.app.inject({ url: '/api/v1/otp/latest', headers: { ...auth(c.iphone), origin: 'https://evil.example' } })).statusCode).toBe(403);
  });
  it('rotates device credentials using a bounded overlap', async () => {
    const rotatedToken = 'N'.repeat(43);
    cfg.pairs[0]!.androidTokenHashes.push(digest(rotatedToken));
    expect((await post(upload(), rotatedToken)).statusCode).toBe(201);
    expect((await post(upload())).statusCode).toBe(201);
    cfg.pairs[0]!.androidTokenHashes.shift();
    expect((await post(upload())).statusCode).toBe(401);
  });
  it('only accepts plaintext under explicit development compatibility', async () => {
    const development = buildApp({ ...cfg, allowPlaintext: true }); await development.app.ready();
    try {
      const body = { messageId: randomUUID(), source: 'android', receivedAt: new Date().toISOString(), code: 'Ab7Cd9Ef2G' };
      expect((await development.app.inject({ method: 'POST', url: '/api/v1/otp', headers: auth(c.android), payload: body })).statusCode).toBe(201);
      expect((await latest()).json().otp.code).toBe('Ab7Cd9Ef2G');
    } finally { await development.app.close(); }
  });
  it('exposes protected, aggregate latency telemetry without code values', async () => {
    await latest();
    const r = await service.app.inject({ url: '/api/v1/metrics', headers: auth(c.metrics) });
    expect(r.statusCode).toBe(200); expect(r.json().routes[0].buckets.length).toBeGreaterThan(1);
    expect(r.body).not.toContain(c.iphone);
  });
  it('fails safely after storage disconnects', async () => {
    await service.store.close();
    expect((await latest()).statusCode).toBe(503);
    expect((await service.app.inject('/ready')).statusCode).toBe(503);
    expect((await service.app.inject('/health')).statusCode).toBe(200);
  });
});
