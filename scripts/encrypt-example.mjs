import { createCipheriv, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
// Dummy codes only. Never pass a real OTP on a command line or save it to disk.
export function encryptedUpload(pairing, code = 'Ab7Cd9Ef2G') {
  const messageId = randomUUID(); const receivedAt = new Date().toISOString();
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(pairing.encryptionKey, 'base64url'), nonce);
  cipher.setAAD(Buffer.from(JSON.stringify(['otp-relay/v1', pairing.pairId, messageId, 'android', receivedAt, pairing.keyId])));
  const ciphertext = Buffer.concat([cipher.update(code, 'utf8'), cipher.final()]);
  return { messageId, source: 'android', receivedAt, encrypted: { algorithm: 'A256GCM', keyId: pairing.keyId,
    nonce: nonce.toString('base64url'), ciphertext: ciphertext.toString('base64url'), tag: cipher.getAuthTag().toString('base64url') } };
}
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const pairing = JSON.parse(await readFile(process.argv[2] ?? 'provisioning/android.json', 'utf8'));
  process.stdout.write(JSON.stringify(encryptedUpload(pairing)) + '\n');
}
