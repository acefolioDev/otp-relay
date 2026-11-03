import { Pool, type QueryResult, type QueryResultRow } from 'pg';

export interface Database {
  query<R extends QueryResultRow = any, I extends any[] = any[]>(
    queryText: string,
    values?: I
  ): Promise<QueryResult<R>>;
  close(): Promise<void>;
  migrate(): Promise<void>;
}

export class PostgresDatabase implements Database {
  private pool: Pool;

  constructor(connectionString?: string) {
    this.pool = new Pool({
      connectionString: connectionString || process.env.DATABASE_URL,
      max: 10,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
    });
  }

  async query<R extends QueryResultRow = any, I extends any[] = any[]>(
    queryText: string,
    values?: I
  ): Promise<QueryResult<R>> {
    return this.pool.query<R>(queryText, values);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async migrate(): Promise<void> {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255),
        google_sub VARCHAR(255) UNIQUE,
        name VARCHAR(255),
        picture TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS devices (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        device_name VARCHAR(100) NOT NULL,
        device_type VARCHAR(20) NOT NULL CHECK (device_type IN ('android', 'ios')),
        auth_token_hash VARCHAR(64) UNIQUE NOT NULL,
        public_key TEXT,
        last_seen_at TIMESTAMPTZ DEFAULT NOW(),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS device_pairs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        pair_code VARCHAR(12) UNIQUE,
        android_device_id UUID REFERENCES devices(id) ON DELETE SET NULL,
        ios_device_id UUID REFERENCES devices(id) ON DELETE SET NULL,
        key_id VARCHAR(64),
        encryption_key TEXT,
        status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'revoked')),
        expires_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      ALTER TABLE device_pairs ADD COLUMN IF NOT EXISTS encryption_key TEXT;

      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id);
      CREATE INDEX IF NOT EXISTS idx_devices_token ON devices(auth_token_hash);
      CREATE INDEX IF NOT EXISTS idx_pairs_user ON device_pairs(user_id);
      CREATE INDEX IF NOT EXISTS idx_pairs_code ON device_pairs(pair_code);
    `);
  }
}
