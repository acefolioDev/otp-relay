import { loadConfig } from './config/env.js';
import { buildApp } from './app.js';
import { RedisStore } from './services/redis-store.js';

async function main() {
  const config = loadConfig();
  const { app, store } = buildApp(config);
  let stopping = false;
  async function shutdown(failed = false) {
    if (stopping) return;
    stopping = true;
    app.log.info({ event: 'shutdown' }, 'Shutting down');
    const deadline = setTimeout(() => process.exit(1), 8000); deadline.unref();
    try { await app.close(); process.exitCode = failed ? 1 : 0; }
    catch { process.exitCode = 1; }
    finally { clearTimeout(deadline); }
  }
  process.once('SIGTERM', () => { void shutdown(); });
  process.once('SIGINT', () => { void shutdown(); });
  if (store instanceof RedisStore) store.onFatal(() => { void shutdown(true); });
  try { await app.listen({ port: config.port, host: '0.0.0.0' }); }
  catch {
    app.log.fatal({ event: 'startup_failed' }, 'Startup failed; check configuration and Redis connectivity');
    await shutdown(true);
  }
}
main().catch(() => {
  // Environment parse errors can include secrets; output only a fixed diagnostic.
  process.stderr.write('Startup failed: verify environment configuration and Redis connectivity.\n');
  process.exitCode = 1;
});
