import { EventEmitter } from 'node:events';
import type { Store } from './types.js';
import { HttpError } from '../utils/errors.js';

export class Waiters {
  private events = new EventEmitter();
  private counts = new Map<string, number>();
  private total = 0;
  private stopped = false;
  private unsubscribe: () => void;
  constructor(store: Store, private maximum: number) {
    this.events.setMaxListeners(0);
    this.unsubscribe = store.onChange(pairId => this.events.emit(pairId));
  }
  acquire(pairId: string) {
    if (this.stopped) throw new HttpError(503, 'Service unavailable');
    if (this.total >= this.maximum || (this.counts.get(pairId) ?? 0) >= 2) {
      throw new HttpError(429, 'Too many pending requests');
    }
    this.total++; this.counts.set(pairId, (this.counts.get(pairId) ?? 0) + 1);
    return () => {
      this.total--; const n = (this.counts.get(pairId) ?? 1) - 1;
      if (n) this.counts.set(pairId, n); else this.counts.delete(pairId);
    };
  }
  // Install BEFORE reading latest to avoid losing an upload between GET and wait.
  listen(pairId: string, signal: AbortSignal, timeoutMs: number) {
    let finish!: () => void;
    let timer: ReturnType<typeof setTimeout>;
    const promise = new Promise<void>(resolve => {
      finish = () => {
        clearTimeout(timer); this.events.off(pairId, finish); this.events.off('stop', finish);
        signal.removeEventListener('abort', finish); resolve();
      };
      this.events.once(pairId, finish); this.events.once('stop', finish);
      signal.addEventListener('abort', finish, { once: true });
      timer = setTimeout(finish, Math.max(1, timeoutMs)); timer.unref();
      if (signal.aborted || this.stopped) finish();
    });
    return { promise, cancel: finish };
  }
  get closed() { return this.stopped; }
  close() { this.stopped = true; this.events.emit('stop'); this.unsubscribe(); }
}
