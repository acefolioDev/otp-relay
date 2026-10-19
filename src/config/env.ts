import { z } from 'zod';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const pairSchema = z.object({
  pairId: z.uuid(),
  androidTokenHashes: z.array(hash).min(1).max(2),
  iphoneTokenHashes: z.array(hash).min(1).max(2),
  keyIds: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)).min(1).max(2),
}).strict();
export type Pair = z.infer<typeof pairSchema>;

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  REDIS_URL: z.url().refine(v => /^rediss?:\/\//.test(v)),
  REDIS_PREFIX: z.string().regex(/^[A-Za-z0-9_-]{1,40}$/).default('otp-relay'),
  PAIRINGS_JSON: z.string(),
  METRICS_TOKEN_HASH: hash,
  OTP_TTL_SECONDS: z.coerce.number().int().min(10).max(90).default(90),
  CLOCK_SKEW_SECONDS: z.coerce.number().int().min(0).max(30).default(10),
  DEV_ALLOW_PLAINTEXT_OTP: z.enum(['true', 'false']).default('false'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  RATE_LIMIT_ANDROID: z.coerce.number().int().min(1).max(100000).default(120),
  RATE_LIMIT_IPHONE: z.coerce.number().int().min(1).max(100000).default(600),
  MAX_LONG_POLLS: z.coerce.number().int().min(1).max(10000).default(200),
});
export interface Config {
  production: boolean; port: number; redisUrl: string; redisPrefix: string;
  pairs: Pair[]; metricsTokenHash: string; ttlMs: number; clockSkewMs: number;
  allowPlaintext: boolean; logLevel: z.infer<typeof schema>['LOG_LEVEL'];
  androidRateLimit: number; iphoneRateLimit: number; maxLongPolls: number;
}
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // Never surface Zod issues containing environment values.
  const parsed = schema.safeParse(env);
  if (!parsed.success) throw new Error('Invalid environment configuration; check .env.example');
  const v = parsed.data;
  let pairs: Pair[];
  try { pairs = z.array(pairSchema).min(1).max(100).parse(JSON.parse(v.PAIRINGS_JSON)); }
  catch { throw new Error('Invalid PAIRINGS_JSON configuration'); }
  const ids = pairs.map(p => p.pairId);
  const hashes = pairs.flatMap(p => [...p.androidTokenHashes, ...p.iphoneTokenHashes]);
  hashes.push(v.METRICS_TOKEN_HASH);
  if (new Set(ids).size !== ids.length || new Set(hashes).size !== hashes.length) {
    throw new Error('Pair IDs and credential hashes must be unique');
  }
  if (v.NODE_ENV === 'production' && v.DEV_ALLOW_PLAINTEXT_OTP === 'true') {
    throw new Error('Plaintext compatibility is prohibited in production');
  }
  return {
    production: v.NODE_ENV === 'production', port: v.PORT, redisUrl: v.REDIS_URL,
    redisPrefix: v.REDIS_PREFIX, pairs, metricsTokenHash: v.METRICS_TOKEN_HASH,
    ttlMs: v.OTP_TTL_SECONDS * 1000, clockSkewMs: v.CLOCK_SKEW_SECONDS * 1000,
    allowPlaintext: v.DEV_ALLOW_PLAINTEXT_OTP === 'true', logLevel: v.LOG_LEVEL,
    androidRateLimit: v.RATE_LIMIT_ANDROID, iphoneRateLimit: v.RATE_LIMIT_IPHONE,
    maxLongPolls: v.MAX_LONG_POLLS,
  };
}
