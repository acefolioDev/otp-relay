# OTP Relay

A Node.js 22, TypeScript and Fastify backend for relaying **your own** Android OTPs to an iPhone over HTTPS. Redis holds one pending, end-to-end encrypted OTP per device pair for **at most 90 seconds**. The phones can use different Apple/Google accounts; the iPhone needs internet access, not cellular SMS or iCloud.

Android encrypts the exact OTP string locally with AES-256-GCM. The iPhone decrypts locally and supplies the string to the supported iOS 18+ AutoFill Credential Provider interface after explicit selection. Railway receives ciphertext, metadata and bearer credentials over TLS; it never receives the OTP encryption key. Alphanumeric codes and leading zeros retain their exact case and characters.

The backend is implemented and locally tested. **No Railway deployment or real-phone delivery benchmark has been performed.** The supplied mobile source still needs Android Studio/Xcode projects, signing, device provisioning and physical-device verification.

```mermaid
sequenceDiagram
    participant A as Android (approved SMS senders)
    participant B as Railway HTTPS / Fastify
    participant R as Private Redis
    participant I as iPhone app / AutoFill extension
    A->>A: Extract OTP, encrypt using paired device key
    A->>B: POST /api/v1/otp (Android credential, ciphertext)
    B->>R: Atomic deduplication + SET with expiry + publish hint
    R-->>B: Pending foreground long poll wakes (any instance)
    I->>B: GET /api/v1/otp/latest (iPhone credential)
    B->>R: Read latest without consuming
    B-->>I: Ciphertext, ID, receivedAt, expiresAt
    I->>I: Authenticate/decrypt; offer exact code for selection
    I->>B: POST /api/v1/otp/:id/consume after selection
    B->>R: Atomically delete payload; retain brief receipt
```

## Requirements and structure

- Node.js 22 LTS and npm. Node 24 is also allowed by `engines`.
- Redis 7.4+ reachable privately in production; Docker Compose is provided for local use.
- Android API 26+, an explicitly approved sender list and SMS permission.
- iOS 18+, Xcode, AutoFill capability, shared App Group and Keychain entitlements.

```text
src/
  app.ts                     Fastify construction, safe logging, lifecycle
  server.ts                  0.0.0.0 listener, signals and bounded shutdown
  config/env.ts              validated environment and pairing registry
  middleware/auth.ts         roles, hashed credentials, shared rate limits
  routes/otp.ts              validation, encrypted API and long polling
  services/                  Redis Lua operations, Pub/Sub, waiters, metrics
  utils/                     credential hashing and sanitized errors
scripts/                     provisioning, encryption example, load/mobile tests
tests/                      Vitest unit and real-Redis integration tests
android/                     Kotlin sender allowlist, extractor, encryption, UI
ios/                        Swift decryption, app and AutoFill extension source
 docs/                       mobile setup, security protocol, verification results
Dockerfile                   multi-stage build, unprivileged production runtime
railway.json                 readiness gate, restart policy, shutdown draining
compose.yaml                 loopback-only development Redis, no persistence
.github/workflows/ci.yml      typecheck, real-Redis tests, build, runtime audit
```

## Local development

Run these commands from the **repository root**. The former `server/server.mjs` and unversioned plaintext API have been replaced.

```bash
npm ci
# Use a trusted LOCAL computer; do not generate device encryption keys on Railway.
npm run provision
cp .env.example .env
# Replace PAIRINGS_JSON and METRICS_TOKEN_HASH in .env with provisioning/server.env values.
# Keep the quotes around PAIRINGS_JSON when using a dotenv/shell file.
docker compose up -d redis
npm run dev
```

If Redis is installed locally, `redis-server --bind 127.0.0.1 --save '' --appendonly no` can replace Compose. A restart of **Redis** loses pending codes in this local configuration; restarting only the backend preserves unexpired Redis state. Production has no in-memory fallback. State is shared across backend replicas.

```bash
export TEST_REDIS_URL=redis://127.0.0.1:6379
npm run typecheck
npm test                          # includes integration when TEST_REDIS_URL is set
npm run test:integration           # fails if TEST_REDIS_URL is missing
npm run build
node --env-file=.env dist/server.js
# In a deployed environment with variables already supplied:
npm start
```

Without `TEST_REDIS_URL`, `npm test` runs the isolated tests and **explicitly skips** the Redis suite. CI requires and executes real Redis tests. [Verification results](docs/verification.md) identify the tests actually executed for this implementation.

## Configuration

All variables are validated at startup. No real secrets are included in the repository.

| Variable | Required/default | Purpose |
|---|---|---|
| `NODE_ENV` | `development`; set `production` on Railway | Enforces production HTTPS and prohibits plaintext |
| `PORT` | Railway supplies it; local `3000` | Listener binds `0.0.0.0` |
| `REDIS_URL` | required | Railway private Redis reference; `redis://` on trusted private network or `rediss://` for TLS |
| `PAIRINGS_JSON` | required, nonempty | JSON array of pair IDs, device **SHA-256 token hashes** and public encryption key IDs |
| `METRICS_TOKEN_HASH` | required | SHA-256 hash of separate operator metrics credential |
| `REDIS_PREFIX` | `otp-relay` | Namespace; use the same value for replicas and a different value for staging/tests |
| `OTP_TTL_SECONDS` | `90` (10–90) | Max lifetime; delayed uploads have a shorter remaining lifetime |
| `CLOCK_SKEW_SECONDS` | `10` (0–30) | Maximum accepted future Android timestamp |
| `LOG_LEVEL` | `info` | Pino severity, including `silent` for isolated benchmarks |
| `DEV_ALLOW_PLAINTEXT_OTP` | `false` | Explicit compatibility switch; startup rejects `true` in production |
| `RATE_LIMIT_ANDROID` | `120` per minute per pair | Shared across replicas and overlapping rotated tokens |
| `RATE_LIMIT_IPHONE` | `600` per minute per pair | Shared GET/consume budget |
| `MAX_LONG_POLLS` | `200` per process | Also limited to two waiting requests per pair **per process** |

`PAIRINGS_JSON` format (use generated values, not these placeholders):

```json
[{
  "pairId": "PAIR_UUID",
  "androidTokenHashes": ["64_LOWERCASE_HEX_CHARACTERS"],
  "iphoneTokenHashes": ["DIFFERENT_64_LOWERCASE_HEX_CHARACTERS"],
  "keyIds": ["PUBLIC_KEY_VERSION_ID"]
}]
```

The registry supports up to 100 pairs and two overlapping credential hashes/key IDs per role/pair for rotation. Pair IDs are UUIDs. Tokens are 32 random bytes encoded as 43 base64url characters; raw device tokens and encryption keys belong only on the devices and trusted provisioning computer. [Provisioning and cryptographic protocol](docs/security.md) explains private transfer, revocation and rotation.

## API

Every response disables caching. Device credentials belong in `Authorization: Bearer …`, never query parameters. No CORS headers are enabled; browser `Origin` requests to protected endpoints are rejected. Production API requests require HTTPS. Bodies are limited to 4096 bytes, unknown JSON properties and unsupported fields are rejected, and errors never echo submitted values.

### `POST /api/v1/otp` — Android only

```json
{
  "messageId": "e1dd14dd-576f-4744-8dfd-a6bc86261134",
  "source": "android",
  "receivedAt": "2026-10-19T12:00:00.000Z",
  "encrypted": {
    "algorithm": "A256GCM",
    "keyId": "public-key-version",
    "nonce": "BASE64URL_12_BYTES",
    "ciphertext": "BASE64URL_ENCRYPTED_CODE",
    "tag": "BASE64URL_16_BYTES"
  }
}
```

Timestamps must be UTC with exactly millisecond precision (`…SSS Z` without the space). All binary fields use unpadded, canonical base64url. Encrypt a raw ASCII OTP of 4–32 letters/digits; ciphertext length is 4–32 bytes. The server can validate envelope shape, not decrypt or verify the GCM tag. The iPhone authenticates the tag and metadata before offering a code.

A fresh write returns `201` with `{"success":true,"messageId":"…","duplicate":false,"expiresIn":90}`. An exact retry returns `200`, `duplicate:true`, and the **remaining** lifetime without restoring or extending the OTP. Changed content under the same ID or nonce reuse returns `409`. A delayed message older than the current one returns `409`. Expired/far-future uploads return `422`.

Only the latest pending payload per pair is retained. Retries must reuse the exact timestamp, UUID, nonce, key ID and ciphertext. Consumption removes ciphertext while a bounded receipt prevents replay. Receipts and nonce guards expire after TTL + twice the clock-skew allowance (110 seconds by default); no OTP history is kept.

The development-only compatibility body is `{messageId, source, receivedAt, code}`. It is accepted only with `DEV_ALLOW_PLAINTEXT_OTP=true` in a non-production environment. There is no legacy `/v1/otp` route. Production never returns a plaintext `code` field.

### `GET /api/v1/otp/latest` — iPhone only

Returns `200 {"available":false}` or:

```json
{
  "available": true,
  "otp": {
    "id": "e1dd14dd-576f-4744-8dfd-a6bc86261134",
    "receivedAt": "2026-10-19T12:00:00.000Z",
    "expiresAt": "2026-10-19T12:01:30.000Z",
    "encrypted": { "algorithm": "A256GCM", "keyId": "...", "nonce": "...", "ciphertext": "...", "tag": "..." }
  }
}
```

Fetching never consumes. Use an immediate GET when the AutoFill extension opens. Foreground apps can use `?waitSeconds=25&afterId=LAST_SEEN_UUID` to wait for a different code; omit `afterId` to wait when empty. A timeout returns `available:false`, even if the already-seen code still exists. A plain GET always returns that valid latest code. Long polls use a shared Redis Pub/Sub wakeup and a final authenticated Redis read, so any replica can wake a request; the durable GET remains authoritative if a hint is missed. Registering the listener before reading avoids an upload/read subscription race.

The provided iOS example uses immediate GETs. Wiring foreground long polling into a complete app is a remaining mobile task. Reconnect foreground waits with jitter/backoff after errors and allow at least 30 seconds for the long-poll response. Never keep the AutoFill extension running as a background listener.

### `POST /api/v1/otp/:id/consume` — iPhone only

No body. Atomically deletes the current matching OTP and records a short idempotency receipt. Returns `204`, including repeated acknowledgement while its receipt exists. Returns `404` for an expired, superseded, unknown or other pair's ID. After the receipt expires, a repeat returns `404`. A stale acknowledgement cannot delete a newer OTP. A GET racing consumption may already have received ciphertext; clients must clear cached values after acknowledgement and check expiry before selection.

### Operations

- `GET /health`: public liveness, status and process uptime. No storage check.
- `GET /ready`: public readiness; `200` only after Redis command and subscription connections are established and PING succeeds; otherwise `503`.
- `GET /api/v1/metrics`: requires separate operator metrics token. Per-process cumulative route histograms, count, sum, mean and error count. Aggregate exported buckets externally across replicas; process restarts reset counters. No OTPs or device identifiers.

Other errors: `401` invalid/wrong-role credential, `403` browser origin, `413` oversized body, `422` invalid schema, `426` HTTPS required, `429` quota/waiter limit, `503` storage unavailable. Rate-limit responses include `Retry-After` for the shared minute quotas. Invalid-auth attempts have a separate 30/minute IP quota. Unrecognized routes return `404`.

## Example requests

Set `BASE_URL` to your actual HTTPS Railway domain. These commands use **placeholder tokens and synthetic codes**. Do not put real OTPs into shell commands, screenshots or logs.

```bash
export BASE_URL=https://YOUR-SERVICE.up.railway.app
export ANDROID_TOKEN=YOUR_ANDROID_DEVICE_TOKEN
export IPHONE_TOKEN=YOUR_IPHONE_DEVICE_TOKEN
export METRICS_TOKEN=YOUR_OPERATOR_METRICS_TOKEN

# Generates fresh, valid ciphertext for a synthetic mixed-case code using local Android pairing material.
node scripts/encrypt-example.mjs provisioning/android.json |
  curl --fail-with-body "$BASE_URL/api/v1/otp" \
    -H "Authorization: Bearer $ANDROID_TOKEN" -H 'Content-Type: application/json' --data-binary @-

curl --fail-with-body "$BASE_URL/api/v1/otp/latest" -H "Authorization: Bearer $IPHONE_TOKEN"
curl --fail-with-body --max-time 30 "$BASE_URL/api/v1/otp/latest?waitSeconds=25" \
  -H "Authorization: Bearer $IPHONE_TOKEN"
curl -i -X POST "$BASE_URL/api/v1/otp/REPLACE_WITH_RETURNED_UUID/consume" \
  -H "Authorization: Bearer $IPHONE_TOKEN"
curl --fail-with-body "$BASE_URL/health"
curl --fail-with-body "$BASE_URL/ready"
curl --fail-with-body "$BASE_URL/api/v1/metrics" -H "Authorization: Bearer $METRICS_TOKEN"
```

For loopback development only, use `BASE_URL=http://127.0.0.1:3000` with `NODE_ENV=development`. Phones require trusted public HTTPS.

## Android and iOS integration

[Mobile setup](docs/mobile-setup.md) contains target membership, signing and provisioning instructions. Preserve the approved sender list. The Android parser prefers the token **immediately following `OTP is`**, preserves mixed case, accepts 4–10 characters with at least one digit, and refuses 11-character app hashes or ambiguous messages. Other recognized numeric formats use a conservative 4–8 digit fallback. Synthetic example:

```text
Your easypaisa mobile account registration/login OTP is Ab7Cd9Ef2G OTP aur PIN ko mahfooz rakhein
```

It extracts `Ab7Cd9Ef2G` exactly. It never scans for arbitrary alphanumeric strings or forwards full SMS text. Adapt parsing only for approved services; the backend and manual test field support 4–32 character codes. Real SMS Retriever routing or Android background restrictions can prevent a general SMS listener from receiving a message.

The Swift app and extension decrypt locally, preserve the string and expiry, and invoke `ASOneTimeCodeCredential(code:)` after explicit selection. Consumption is a best-effort request in the AutoFill completion callback; iOS may end the extension before it finishes, so TTL remains the final expiration boundary. This callback acknowledges selection, not whether the target service accepted the OTP. No account matching or iCloud dependency exists.

## Railway deployment and Redis setup

1. Commit/push to `git@github.com:acefolioDev/otp-relay.git` (commands below). In Railway, create a project, add **Deploy from GitHub repo**, and choose `acefolioDev/otp-relay`. Keep the service root at `/`.
2. Add a Railway Redis service **in the same project/environment/region** as the backend. Configure Redis with bounded memory and **`maxmemory-policy noeviction`**. Evicting deduplication/nonce keys early weakens replay protection. Choose enough memory for peak traffic and quotas; exhausted memory must fail writes safely.
3. Use Redis without RDB/AOF/backups when pending OTPs must not survive Redis restarts (`save ""`, `appendonly no`). Backend restarts remain safe because Redis is external. If managed persistence/backups are enabled, ciphertext can outlive logical expiry on disk; establish a retention policy. TTL/deletion is logical invalidation, not guaranteed physical media erasure.
4. On a trusted local computer, run `npm run provision`. Privately import `android.json` on Android and `iphone.json` on iPhone. Do **not** upload these files or their `encryptionKey` to Railway or GitHub. Set only the values from `server.env` in Railway. In Railway's individual variable editor, paste the raw JSON array for `PAIRINGS_JSON` without surrounding shell quotes.
5. Set `NODE_ENV=production`, `REDIS_URL=${{Redis.REDIS_URL}}` (replace `Redis` with the actual service name), `PAIRINGS_JSON`, and `METRICS_TOKEN_HASH`. Keep `OTP_TTL_SECONDS=90`, `LOG_LEVEL=info`, `DEV_ALLOW_PLAINTEXT_OTP=false`. Railway supplies `PORT`. Confirm the Redis URL uses the private `*.railway.internal` hostname; remove Redis public TCP proxy exposure. Never substitute a publicly reachable plaintext Redis URL.
6. Deploy. Railway uses the root Dockerfile: `npm ci`, TypeScript production build, prune dev dependencies, unprivileged Node runtime. `railway.json` gates traffic on `/ready`, uses up to 10 failure restarts and allows 10 seconds for draining; the application has an 8-second shutdown deadline. SIGTERM/SIGINT stop long polls and close Redis connections.
7. Generate the backend's **public HTTPS domain** under service networking. Keep backend ingress behind Railway TLS termination. The application trusts exactly the nearest proxy hop for HTTPS/IP headers; direct untrusted access to the Node listener must not bypass that boundary. Additional proxies need an explicitly reviewed trust policy.
8. Verify `/health` and `/ready` over the public HTTPS domain. An uncredentialed `/api/v1/otp/latest` must return `401`. Check that no device secrets/codes appear in service logs. Railway's deploy readiness check is not continuous monitoring; configure an external readiness monitor.
9. Upload a fresh **synthetic** encrypted code, retrieve/decrypt it, consume it, and verify that the next GET is empty. Provision both mobile clients with the HTTPS domain and test allowlisted SMS → AutoFill on physical devices. Measure that path before making a delivery claim.

Replicas share Redis data, replay guards and rate limits. Long-poll resource caps are per process; production connection limits must account for replica count. Registry or token changes require a rolling deployment; revocations take full effect once all old replicas have drained. There is no local runtime filesystem state, APNs dependency, PostgreSQL or public pairing/admin endpoint.

Repository author is configured locally as Muhammad Atif `<dev.muhammad.atif@gmail.com>`. To publish the prepared commit when desired:

```bash
git remote -v
git status
git push -u origin main
```

No force push or global Git configuration is used. Railway access and an actual successful deployment are required before a deployed URL can be reported.

## Security model

- Offline operator provisioning gives each pair two independent device credentials and a shared 256-bit encryption key. The server holds only credential hashes and public key IDs. AES-GCM authenticates pair/message/source/time/key metadata as AAD; detailed wire format and rotation: [security protocol](docs/security.md).
- Redis Lua scripts atomically deduplicate, reject a recently reused nonce, set TTL on creation and consume by ID. Redis TIME governs acceptance and expiry. Delayed uploads do not reset a full 90-second lifetime. Tombstones retain no ciphertext/code.
- Logs use generated request IDs, route templates, numeric timings, status and duplicate flags. No raw request URL/body/headers, validation values or driver errors are serialized. Client-to-server timing uses an untrusted device timestamp and is diagnostic only. Use synchronized device clocks.
- There is no automatic forwarding without an explicit exact sender allowlist and user enable switch. Sender names can be spoofed at the telecom layer; the allowlist controls forwarding scope, not the authenticity of the service issuing an OTP.
- Device credentials authorize a role within one pair. A compromised device/key can expose that pair's codes. Revoke credentials, remove the pair and securely provision fresh device keys after compromise. Bearer tokens do not provide proof of possession after theft.
- APNs is an optional **future integration**, not implemented here. A push may contain only an opaque change hint, never a code/ciphertext/token. Silent push/background wake is best effort; neither APNs nor a continuously running extension can be assumed. Retrieval always works through authenticated GET while an OTP is valid.

## Latency testing and observability

Goals: each immediate backend route p95 <200ms; normal backend handling ideally 1–3 seconds or better; overall Android SMS → iOS selection target <15 seconds. These are goals, **not measured production SLAs**. Network/SMS delay, APNs, OS scheduling, AutoFill support and user interaction are outside backend control.

`Server-Timing: app;dur=…` and safe structured `durationMs` logs measure server request duration; POST also logs client timestamp age. Authenticated metrics expose cumulative histograms. Long-poll durations intentionally include waiting; a `longPoll` log field and separate `(long_poll)` histogram series distinguish them from immediate requests. Export logs/metrics to your monitoring system to derive production percentiles; no real codes should enter telemetry.

The dependency-free load client uses Node HTTP keep-alive and histograms. It measures full HTTP request/response latency for **encrypted upload → GET → consume** cycles and reports average/p50/p95/p99, status counts, error rate and throughput, both overall and per route. Encryption is performed on the client before the POST timer. Throughput includes all cycle work.

```bash
# Use an isolated test deployment/namespace and synthetic pairing material.
# For sustained local load only, increase quotas in .env to 100000 and restart.
# Keep real production quotas at a level appropriate for SMS traffic.
LOAD_BASE_URL=http://127.0.0.1:3000 LOAD_SECONDS=5 LOAD_CONCURRENCY=1 npm run load
```

Default pairing paths are `provisioning/android.json` and `provisioning/iphone.json`; override `LOAD_ANDROID_PAIRING_FILE` / `LOAD_IPHONE_PAIRING_FILE` for another synthetic pair. Concurrency 1 tests one pair's complete lifecycle. Higher concurrency on one pair intentionally contends for its single latest slot and may produce `409`/`404` conflicts, which are counted as errors; use multiple separately paired load processes to model independent users. Quota `429`s are errors too; the script exits nonzero on HTTP/network failures. Remote tests require HTTPS. Run repeated warm/cold tests against Railway and compare with [the actual local sample](docs/verification.md).

For real devices, record monotonic timestamps at SMS callback, extraction/encryption, HTTP completion, iPhone retrieval/decryption and the AutoFill selection callback; associate them with message ID, never code. Synchronized wall clocks are necessary for cross-device differences. Separate user interaction delay from backend duration.

## Troubleshooting

| Symptom | Checks |
|---|---|
| Startup fails / `/ready` is 503 | Required env values, valid nonempty pair registry, private Redis hostname, Redis memory/connectivity; error text is intentionally generic |
| API returns 401 | Role-specific token, pairing hash, no accidental newline, old replicas after rotation; credentials never belong in URLs |
| API returns 426 on Railway | Request reaches the generated HTTPS domain and Railway supplies the trusted forwarded-proto header; do not disable HTTPS enforcement |
| API returns 422 | UUID, millisecond UTC timestamp, device clock, approved key ID, base64url envelope; production refuses plaintext |
| API returns 409 | Reused ID with different content, reused nonce, or a delayed upload older than the latest one; retries must reuse the original encrypted request |
| API returns 429 | Read Retry-After for shared quotas; release duplicate foreground waits; check per-process waiter caps |
| No code | Expired/consumed/replaced code, incorrect pair, no approved SMS sender, missing SMS permission; create a fresh synthetic upload |
| Decryption fails | Both devices need the same pair ID, key ID and encryption key; authenticate the exact AAD bytes; never normalize code case |
| AutoFill provider missing | Both target capabilities, `ProvidesOneTimeCodes`, iOS 18+, shared App Group, Keychain access group, physical-device signing |
| Keychain error -34018 | Replace `YOUR_TEAM_ID` and match signed access groups in both iOS targets |
| Fetch works, AutoFill unavailable | The target input must support AutoFill; test Safari `autocomplete="one-time-code"` or `.textContentType = .oneTimeCode` |
| Android test succeeds, SMS fails | Sender ID spelling, user permission, OS background limits and SMS Retriever routing; do not broaden to all SMS |

Redis commands fail within a bounded deadline, do not queue while disconnected and reconnect with capped backoff. Exhausted reconnects trigger a failed process shutdown for Railway restart. There is no fallback that could return stale or another device's data. A timed-out write can have succeeded before the response was lost: retry its **identical** envelope.

## Production checklist and remaining integration

- [ ] Deploy with private Redis, no early eviction, reviewed persistence/retention and correct environment values.
- [ ] Transfer only the intended private pairing material to each device; verify sharing/signing; delete transport copies.
- [ ] Test actual approved senders and confirm exact mixed-case/leading-zero codes through supported AutoFill fields.
- [ ] Add durable encrypted Android retry work with original message IDs/envelopes and expiry if required by device background behavior.
- [ ] Wire foreground long polling, connection cancellation/backoff and reliable consumption retry/cache invalidation in the complete iOS app.
- [ ] Add service-specific confirmation/matching before offering a code to an unrelated requesting service.
- [ ] Evaluate optional APNs with opaque hints; never rely on it for correctness.
- [ ] Monitor readiness, quota errors, Redis memory, server latency and mobile segment latency; rehearse rotation/revocation and Redis loss.
- [ ] Measure real Android-to-iPhone latency; no <15-second claim until physical-device evidence exists.

Official references: [Fastify logging](https://fastify.dev/docs/latest/Reference/Logging/), [node-redis production guidance](https://redis.io/docs/latest/develop/clients/nodejs/produsage/), [Railway config as code](https://docs.railway.com/config-as-code/reference), [Railway health checks](https://docs.railway.com/deployments/healthchecks), [Apple OTP AutoFill](https://developer.apple.com/documentation/authenticationservices/providing-one-time-passcodes-to-autofill), [Google SMS Retriever message/hash format](https://developers.google.com/identity/sms-retriever/verify).

## Deployment handoff: what to send afterward

Deploy the **backend first** using the Railway steps above. After deployment, send:

1. The public **HTTPS backend URL** (for example `https://…up.railway.app`).
2. The status/output of `GET /health` and `GET /ready`. If deployment failed, the sanitized build/runtime error and which step failed.
3. The intended Android package name and iOS app/extension bundle IDs; your Apple Team ID, App Group ID and Keychain access group when ready. These are configuration identifiers, not signing credentials.
4. The exact approved SMS sender IDs, including Easypaisa's ID as reported on your Android device, and any additional OTP formats to support. Use synthetic/redacted examples.
5. Existing Android Studio/Xcode project files if you have already created them, plus your Android and iOS versions for device testing.

Keep the generated device tokens, AES keys, `android.json`, `iphone.json`, and operator metrics token in your private local provisioning files; enter/import them directly on the appropriate devices or environment. They are not needed in chat. Railway needs only `server.env` values and the private Redis variable reference. There is no mobile build or real-device latency claim pending this deployment handoff.

With that information, the next phase is to configure the mobile clients for the actual deployed URL, finish app project/signing setup, verify the sender allowlist and exact-case AutoFill behavior, and measure real end-to-end delivery.
