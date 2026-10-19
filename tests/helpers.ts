import { randomBytes, randomUUID, createCipheriv, createDecipheriv } from 'node:crypto';
import { digest, associatedData } from '../src/utils/crypto.js';
import { loadConfig } from '../src/config/env.js';
import type { Config } from '../src/config/env.js';
import type { Upload, StoredOtp } from '../src/services/types.js';

export const credentials = {
  android: randomBytes(32).toString('base64url'), iphone: randomBytes(32).toString('base64url'),
  otherAndroid: randomBytes(32).toString('base64url'), otherIphone: randomBytes(32).toString('base64url'),
  metrics: randomBytes(32).toString('base64url'),
};
export const pairId = randomUUID(), otherPairId = randomUUID();
export const key = randomBytes(32);
export const keyId = 'test-key';
export function config(overrides: Partial<Config> = {}): Config {
  return { ...loadConfig({
    NODE_ENV: 'test', REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://127.0.0.1:6379',
    PAIRINGS_JSON: JSON.stringify([
      { pairId, androidTokenHashes: [digest(credentials.android)], iphoneTokenHashes: [digest(credentials.iphone)], keyIds: [keyId] },
      { pairId: otherPairId, androidTokenHashes: [digest(credentials.otherAndroid)], iphoneTokenHashes: [digest(credentials.otherIphone)], keyIds: [keyId] },
    ]),
    METRICS_TOKEN_HASH: digest(credentials.metrics), REDIS_PREFIX: `test-${randomBytes(8).toString('hex')}`, LOG_LEVEL: 'silent',
  }), ...overrides };
}
export function upload(options: { code?: string; pair?: string; receivedAt?: string } = {}): Upload {
  const messageId = randomUUID(), receivedAt = options.receivedAt ?? new Date().toISOString();
  const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(Buffer.from(associatedData(options.pair ?? pairId, messageId, receivedAt, keyId)));
  const ciphertext = Buffer.concat([cipher.update(options.code ?? 'Ab7Cd9Ef2G', 'utf8'), cipher.final()]);
  return { messageId, source: 'android', receivedAt, encrypted: { algorithm: 'A256GCM', keyId,
    nonce: nonce.toString('base64url'), tag: cipher.getAuthTag().toString('base64url'), ciphertext: ciphertext.toString('base64url') } };
}
export function decrypt(item: StoredOtp, pair = pairId): string {
  const e = item.encrypted!, cipher = createDecipheriv('aes-256-gcm', key, Buffer.from(e.nonce, 'base64url'));
  cipher.setAAD(Buffer.from(associatedData(pair, item.id, item.receivedAt, e.keyId)));
  cipher.setAuthTag(Buffer.from(e.tag, 'base64url'));
  return Buffer.concat([cipher.update(Buffer.from(e.ciphertext, 'base64url')), cipher.final()]).toString('utf8');
}
export const auth = (token: string) => ({ authorization: `Bearer ${token}` });
