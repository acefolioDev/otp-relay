import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createDecipheriv } from 'node:crypto';
import { encryptedUpload } from './encrypt-example.mjs';
const base = process.env.RELAY_BASE_URL ?? 'https://otp-relay-production-a3b3.up.railway.app';
if (!base.startsWith('https://')) throw new Error('Deployment verification requires HTTPS');
const android = JSON.parse(await readFile('provisioning/android.json', 'utf8'));
const iphone = JSON.parse(await readFile('provisioning/iphone.json', 'utf8'));
const results = [];
async function request(method, path, token, body) {
  const start = performance.now();
  const response = await fetch(base + path, { method, headers: { ...(token ? { authorization: `Bearer ${token}` } : {}),
    ...(body ? { 'content-type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000), redirect: 'error' });
  const data = response.status === 204 ? null : await response.json();
  results.push({ method, route: path.includes('/consume') ? '/api/v1/otp/:id/consume' : path,
    status: response.status, httpDurationMs: +(performance.now() - start).toFixed(2), serverTiming: response.headers.get('server-timing') });
  return { response, data };
}
assert.equal((await request('GET', '/health')).response.status, 200);
assert.equal((await request('GET', '/ready')).response.status, 200);
assert.equal((await request('GET', '/api/v1/otp/latest')).response.status, 401);
const body = encryptedUpload(android);
assert.equal((await request('POST', '/api/v1/otp', android.token, body)).response.status, 201);
const duplicate = await request('POST', '/api/v1/otp', android.token, body);
assert.equal(duplicate.response.status, 200); assert.equal(duplicate.data.duplicate, true);
const read = await request('GET', '/api/v1/otp/latest', iphone.token);
assert.equal(read.response.status, 200); assert.equal(read.data.otp.id, body.messageId);
const otp = read.data.otp, e = otp.encrypted;
assert.equal(otp.code, undefined);
const cipher = createDecipheriv('aes-256-gcm', Buffer.from(iphone.encryptionKey, 'base64url'), Buffer.from(e.nonce, 'base64url'));
cipher.setAAD(Buffer.from(JSON.stringify(['otp-relay/v1', iphone.pairId, otp.id, 'android', otp.receivedAt, e.keyId])));
cipher.setAuthTag(Buffer.from(e.tag, 'base64url'));
assert.equal(Buffer.concat([cipher.update(Buffer.from(e.ciphertext, 'base64url')), cipher.final()]).toString('utf8'), 'Ab7Cd9Ef2G');
for (let i = 0; i < 2; i++) assert.equal((await request('POST', `/api/v1/otp/${otp.id}/consume`, iphone.token)).response.status, 204);
assert.deepEqual((await request('GET', '/api/v1/otp/latest', iphone.token)).data, { available: false });
const report = { verifiedAt: new Date().toISOString(), baseURL: base, result: 'passed',
  checks: ['public HTTPS', 'health', 'Redis readiness', 'authentication required', 'encrypted upload', 'deduplication', 'exact-case local decryption', 'atomic consumption', 'idempotent acknowledgement', 'empty after consumption'], results };
await writeFile('docs/deployment-verification.json', JSON.stringify(report, null, 2) + '\n');
console.log('Live Railway verification passed; safe timing/status report saved. No OTP values or credentials logged.');
