import http from 'node:http';
import https from 'node:https';
import { readFile } from 'node:fs/promises';
import { createHistogram, performance } from 'node:perf_hooks';
import { encryptedUpload } from './encrypt-example.mjs';

const base = new URL(process.env.LOAD_BASE_URL ?? 'http://127.0.0.1:3000');
if (base.protocol !== 'https:' && !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname)) throw new Error('Remote load tests require HTTPS');
if (base.username || base.password) throw new Error('Do not put credentials in URLs');
const android = JSON.parse(await readFile(process.env.LOAD_ANDROID_PAIRING_FILE ?? 'provisioning/android.json', 'utf8'));
const iphone = JSON.parse(await readFile(process.env.LOAD_IPHONE_PAIRING_FILE ?? 'provisioning/iphone.json', 'utf8'));
const seconds = Number(process.env.LOAD_SECONDS ?? 5), concurrency = Number(process.env.LOAD_CONCURRENCY ?? 1);
if (!Number.isInteger(seconds) || seconds < 1 || seconds > 300 || !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 100) throw new Error('Invalid load settings');
const transport = base.protocol === 'https:' ? https : http;
const agent = new transport.Agent({ keepAlive: true, maxSockets: concurrency });
const stats = Object.fromEntries(['upload', 'latest', 'consume'].map(name => [name, { histogram: createHistogram(), count: 0, errors: 0, statuses: {} }]));
function request(name, method, path, token, payload) {
  const stat = stats[name], start = performance.now();
  return new Promise(resolve => {
    let done = false;
    const finish = (status, data = '') => {
      if (done) return; done = true;
      stat.histogram.record(Math.max(1, Math.round((performance.now() - start) * 1e6)));
      stat.count++; if (status < 200 || status >= 300) stat.errors++;
      stat.statuses[status] = (stat.statuses[status] ?? 0) + 1;
      resolve({ status, data });
    };
    const raw = payload ? JSON.stringify(payload) : undefined;
    const req = transport.request(new URL(path, base), { method, agent, headers: {
      authorization: `Bearer ${token}`,
      ...(raw ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(raw) } : {}),
    } }, res => {
      let data = ''; res.setEncoding('utf8'); res.on('data', chunk => { data += chunk; });
      res.on('end', () => finish(res.statusCode ?? 0, data)); res.on('error', () => finish(0));
    });
    req.setTimeout(5000, () => req.destroy()); req.on('error', () => finish(0));
    req.end(raw);
  });
}
const start = performance.now(), end = start + seconds * 1000;
try {
  await Promise.all(Array.from({ length: concurrency }, async () => {
    while (performance.now() < end) {
      const upload = encryptedUpload(android);
      const sent = await request('upload', 'POST', '/api/v1/otp', android.token, upload);
      if (sent.status < 200 || sent.status >= 300) continue;
      await request('latest', 'GET', '/api/v1/otp/latest', iphone.token);
      await request('consume', 'POST', `/api/v1/otp/${upload.messageId}/consume`, iphone.token);
    }
  }));
} finally { agent.destroy(); }
const durationSeconds = (performance.now() - start) / 1000;
const routes = Object.fromEntries(Object.entries(stats).map(([name, s]) => [name, {
  count: s.count, errors: s.errors, errorRate: s.count ? s.errors / s.count : null, statuses: s.statuses,
  averageMs: s.histogram.count ? s.histogram.mean / 1e6 : null,
  p50Ms: s.histogram.count ? s.histogram.percentile(50) / 1e6 : null,
  p95Ms: s.histogram.count ? s.histogram.percentile(95) / 1e6 : null,
  p99Ms: s.histogram.count ? s.histogram.percentile(99) / 1e6 : null,
  requestsPerSecond: s.count / durationSeconds,
}]));
process.stdout.write(JSON.stringify({ timestamp: new Date().toISOString(), node: process.version,
  workload: 'encrypted upload -> latest -> consume cycles; HTTP keep-alive; per-route request latency',
  concurrency, durationSeconds, requestsPerSecond: Object.values(stats).reduce((n, s) => n + s.count, 0) / durationSeconds, routes }, null, 2) + '\n');
if (Object.values(stats).some(s => s.errors)) process.exitCode = 1;
