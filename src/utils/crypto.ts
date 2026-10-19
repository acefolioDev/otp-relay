import { createHash, timingSafeEqual } from 'node:crypto';
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export function matchesHash(token: string, expected: string): boolean {
  return timingSafeEqual(Buffer.from(digest(token), 'hex'), Buffer.from(expected, 'hex'));
}
// Bind ciphertext to this exact pair, message, source and timestamp on both devices.
export function associatedData(pairId: string, messageId: string, receivedAt: string, keyId: string): string {
  return JSON.stringify(['otp-relay/v1', pairId, messageId, 'android', receivedAt, keyId]);
}
