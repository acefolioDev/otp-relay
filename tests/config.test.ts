import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config/env.js';
import { config, credentials, pairId, keyId } from './helpers.js';
import { digest, matchesHash } from '../src/utils/crypto.js';

const env = () => ({ REDIS_URL: 'redis://localhost:6379', METRICS_TOKEN_HASH: digest(credentials.metrics),
  PAIRINGS_JSON: JSON.stringify([{ pairId, androidTokenHashes: [digest(credentials.android)],
    iphoneTokenHashes: [digest(credentials.iphone)], keyIds: [keyId] }]) });
describe('configuration and credentials', () => {
  it('uses production-safe defaults', () => { const c = config(); expect(c.allowPlaintext).toBe(false); expect(c.ttlMs).toBe(90000); });
  it('rejects plaintext in production', () => expect(() => loadConfig({ ...env(), NODE_ENV: 'production', DEV_ALLOW_PLAINTEXT_OTP: 'true' })).toThrow());
  it('rejects missing credentials and oversized TTL', () => {
    expect(() => loadConfig({})).toThrow();
    expect(() => loadConfig({ ...env(), OTP_TTL_SECONDS: '3600' })).toThrow();
  });
  it('rejects reused device credentials and pair IDs', () => {
    const e = env(); const pairs = JSON.parse(e.PAIRINGS_JSON); pairs.push(pairs[0]);
    expect(() => loadConfig({ ...e, PAIRINGS_JSON: JSON.stringify(pairs) })).toThrow();
    expect(() => loadConfig({ ...e, METRICS_TOKEN_HASH: digest(credentials.android) })).toThrow();
  });
  it('compares hashed secrets safely', () => {
    expect(matchesHash(credentials.android, digest(credentials.android))).toBe(true);
    expect(matchesHash('wrong', digest(credentials.android))).toBe(false);
  });
  it('does not include environment secrets in errors', () => {
    const secret = 'not-a-valid-url-SUPERSECRET';
    try { loadConfig({ ...env(), REDIS_URL: secret }); } catch (e) { expect(String(e)).not.toContain(secret); }
  });
});
