import { readFileSync } from 'node:fs';
import { createDecipheriv } from 'node:crypto';
import { it, expect } from 'vitest';
import { associatedData } from '../src/utils/crypto.js';
it('matches the public AES-GCM vector also tested by Kotlin and Swift', () => {
  const vector = JSON.parse(readFileSync(new URL('./fixtures/encryption-vector.json', import.meta.url), 'utf8'));
  const item = vector.response.otp, e = item.encrypted;
  const aad = associatedData(vector.pairing.pairId, item.id, item.receivedAt, e.keyId);
  expect(aad).toBe(vector.aad);
  const cipher = createDecipheriv('aes-256-gcm', Buffer.from(vector.pairing.encryptionKey, 'base64url'), Buffer.from(e.nonce, 'base64url'));
  cipher.setAAD(Buffer.from(aad)); cipher.setAuthTag(Buffer.from(e.tag, 'base64url'));
  expect(Buffer.concat([cipher.update(Buffer.from(e.ciphertext, 'base64url')), cipher.final()]).toString('utf8')).toBe(vector.code);
});
