import { randomBytes, createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
// For rotation: write locally, then add the hash to the appropriate pair's hash array.
const token = randomBytes(32).toString('base64url');
if (!process.argv[2]) throw new Error('Usage: node scripts/credential.mjs /private/path/new-credential.json');
await writeFile(process.argv[2], JSON.stringify({ token, sha256: createHash('sha256').update(token).digest('hex') }, null, 2), { mode: 0o600, flag: 'wx' });
process.stdout.write('Credential file created. Add hash, deploy, update device token, then remove old hash and redeploy.\n');
