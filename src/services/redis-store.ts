import { createClient } from 'redis';
import { EventEmitter } from 'node:events';
import type { Logger } from 'pino';
import { digest } from '../utils/crypto.js';
import { HttpError, StorageError } from '../utils/errors.js';
import { CONSUME, LIMIT, PUT } from './scripts.js';
import type { PutResult, Store, StoredOtp, Upload } from './types.js';

export class RedisStore implements Store {
  private client;
  private subscriber;
  private events = new EventEmitter();
  private subscriptionReady = false;
  private closing = false;
  private restartTimer: ReturnType<typeof setTimeout> | undefined;
  private prefix: string;
  constructor(url: string, prefix: string, private logger: Logger) {
    this.prefix = prefix;
    this.events.setMaxListeners(0);
    this.client = createClient({
      url, disableOfflineQueue: true, commandsQueueMaxLength: 1000,
      socket: {
        connectTimeout: 2000,
        reconnectStrategy: retries => retries >= 8 ? new Error('Reconnect budget exhausted')
          : Math.min(100 * 2 ** retries, 2000) + Math.floor(Math.random() * 100),
      },
    });
    this.subscriber = this.client.duplicate();
    // Never log driver errors: they may contain connection URLs or credentials.
    for (const client of [this.client, this.subscriber]) {
      client.on('error', () => this.logger.warn({ event: 'redis_error' }, 'Redis connection error'));
      client.on('reconnecting', () => this.logger.info({ event: 'redis_reconnecting' }, 'Redis reconnecting'));
      const terminal = () => {
        if (this.closing || this.restartTimer) return;
        // Exhausted reconnects need process restart; server exits via this event.
        this.restartTimer = setTimeout(() => this.events.emit('fatal'), 1000);
        this.restartTimer.unref();
      };
      client.on('end', terminal);
      client.on('terminated', terminal);
    }
  }
  onFatal(listener: () => void) { this.events.once('fatal', listener); }
  private key(pairId: string, suffix: string) { return `${this.prefix}:{${pairId}}:${suffix}`; }
  private async bounded<T>(operation: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([operation, new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          // Destroy timed-out sockets so pending commands cannot accumulate indefinitely.
          if (this.client.isOpen) this.client.destroy();
          reject(new StorageError());
        }, 2000);
        timer.unref();
      })]);
    } catch { throw new StorageError(); }
    finally { clearTimeout(timer); }
  }
  private check() { if (!this.client.isReady || !this.subscriber.isReady || !this.subscriptionReady) throw new StorageError(); }
  async start() {
    await this.bounded(Promise.all([this.client.connect(), this.subscriber.connect()]));
    await this.bounded(this.subscriber.pSubscribe(`${this.prefix}:events:*`, (_message, channel) => {
      this.events.emit('change', channel.slice(`${this.prefix}:events:`.length));
    }));
    this.subscriptionReady = true;
  }
  async ready() {
    try { this.check(); return await this.bounded(this.client.ping()) === 'PONG'; }
    catch { return false; }
  }
  async put(pairId: string, upload: Upload, ttlMs: number, skewMs: number): Promise<PutResult> {
    this.check();
    // Parsed property order is deterministic across retries; only digest is retained in tombstones.
    const fingerprint = digest(JSON.stringify(upload));
    const result = await this.bounded(this.client.eval(PUT, {
      keys: [this.key(pairId, 'latest'), this.key(pairId, `message:${upload.messageId}`),
        this.key(pairId, `nonce:${digest(`${upload.encrypted?.keyId}:${upload.encrypted?.nonce}`)}`)],
      arguments: [fingerprint, JSON.stringify({ id: upload.messageId, receivedAt: upload.receivedAt,
        ...(upload.encrypted ? { encrypted: upload.encrypted } : { code: upload.code }) }),
      String(Date.parse(upload.receivedAt)), String(ttlMs), String(skewMs),
      upload.encrypted ? 'encrypted' : 'plaintext', `${this.prefix}:events:${pairId}`],
    })) as string[];
    if (result[0] === 'conflict') throw new HttpError(409, 'Message ID already used');
    if (result[0] === 'nonce') throw new HttpError(409, 'Encryption nonce already used');
    if (result[0] === 'stale') throw new HttpError(422, 'Message timestamp outside allowed window');
    if (result[0] === 'order') throw new HttpError(409, 'A newer message is already available');
    return { duplicate: result[0] === 'duplicate', expiresIn: Number(result[1]) };
  }
  async latest(pairId: string): Promise<StoredOtp | null> {
    this.check();
    const value = await this.bounded(this.client.get(this.key(pairId, 'latest')));
    if (!value) return null;
    const item = JSON.parse(value) as StoredOtp & { receivedMs: number; expiresMs: number };
    return { id: item.id, receivedAt: item.receivedAt, expiresAt: new Date(item.expiresMs).toISOString(),
      ...(item.encrypted ? { encrypted: item.encrypted } : { code: item.code! }) };
  }
  async consume(pairId: string, id: string) {
    this.check();
    return Number(await this.bounded(this.client.eval(CONSUME, {
      keys: [this.key(pairId, 'latest'), this.key(pairId, `message:${id}`)], arguments: [id],
    }))) === 1;
  }
  async limit(key: string, max: number, windowMs: number) {
    this.check();
    const [count, ttl] = await this.bounded(this.client.eval(LIMIT, {
      keys: [`${this.prefix}:limit:${digest(key)}`], arguments: [String(windowMs)],
    })) as number[];
    return { allowed: count! <= max, retryAfter: Math.max(1, Math.ceil(ttl! / 1000)) };
  }
  onChange(listener: (pairId: string) => void) {
    this.events.on('change', listener);
    return () => { this.events.off('change', listener); };
  }
  async close() {
    this.closing = true;
    clearTimeout(this.restartTimer);
    this.subscriptionReady = false;
    this.events.removeAllListeners();
    // No unbounded QUIT wait during container termination.
    for (const client of [this.subscriber, this.client]) if (client.isOpen) client.destroy();
  }
}
