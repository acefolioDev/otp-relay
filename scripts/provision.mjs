import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const directory = resolve(process.argv[2] ?? 'provisioning');
const secret = () => randomBytes(32).toString('base64url');
const hash = value => createHash('sha256').update(value).digest('hex');
const pairId = randomUUID();
const keyId = randomBytes(12).toString('base64url');
const encryptionKey = secret();
const android = secret(), iphone = secret(), metrics = secret();
const pair = { pairId, androidTokenHashes: [hash(android)], iphoneTokenHashes: [hash(iphone)], keyIds: [keyId] };
try {
  // Fail if the directory already exists. Never overwrite existing provisioning material.
  await mkdir(directory, { mode: 0o700 });
  const save = (name, content) => writeFile(resolve(directory, name), content, { mode: 0o600, flag: 'wx' });
  await save('android.json', JSON.stringify({ role: 'android', pairId, token: android, keyId, encryptionKey }, null, 2));
  await save('iphone.json', JSON.stringify({ role: 'iphone', pairId, token: iphone, keyId, encryptionKey }, null, 2));
  await save('server.env', `PAIRINGS_JSON='${JSON.stringify([pair])}'\nMETRICS_TOKEN_HASH=${hash(metrics)}\n`);
  await save('metrics.json', JSON.stringify({ token: metrics }, null, 2));
  process.stdout.write(`Provisioning files created in ${directory}. Transfer each device file privately; deploy only server.env.\n`);
} catch {
  process.stderr.write('Provisioning failed. Use a new private directory and check permissions.\n');
  process.exitCode = 1;
}
