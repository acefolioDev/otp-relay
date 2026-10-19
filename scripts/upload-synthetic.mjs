import { readFile } from 'node:fs/promises';
import { encryptedUpload } from './encrypt-example.mjs';
const pairing = JSON.parse(await readFile('provisioning/android.json', 'utf8'));
const base = process.env.RELAY_BASE_URL ?? 'https://otp-relay-production-a3b3.up.railway.app';
if (!base.startsWith('https://')) throw new Error('HTTPS required');
const response = await fetch(base + '/api/v1/otp', {
  method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
  headers: { authorization: `Bearer ${pairing.token}`, 'content-type': 'application/json' },
  body: JSON.stringify(encryptedUpload(pairing)),
});
if (response.status !== 201) throw new Error(`Synthetic upload failed with HTTP ${response.status}`);
console.log('Synthetic encrypted code uploaded. Fetch it in the paired app within 90 seconds.');
