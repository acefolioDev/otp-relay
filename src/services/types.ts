export interface Envelope {
  algorithm: 'A256GCM'; keyId: string; nonce: string; ciphertext: string; tag: string;
}
export interface StoredOtp {
  id: string; receivedAt: string; expiresAt: string;
  encrypted?: Envelope; code?: string;
}
export interface Upload {
  messageId: string; source: 'android'; receivedAt: string;
  encrypted?: Envelope; code?: string;
}
export interface PutResult { duplicate: boolean; expiresIn: number }
export interface Store {
  start(): Promise<void>;
  ready(): Promise<boolean>;
  put(pairId: string, upload: Upload, ttlMs: number, skewMs: number): Promise<PutResult>;
  latest(pairId: string): Promise<StoredOtp | null>;
  consume(pairId: string, id: string): Promise<boolean>;
  limit(key: string, max: number, windowMs: number): Promise<{ allowed: boolean; retryAfter: number }>;
  onChange(listener: (pairId: string) => void): () => void;
  close(): Promise<void>;
}
