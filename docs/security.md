# Provisioning, encryption and lifecycle

## Trusted initial provisioning

There is no anonymous registration or internet pairing endpoint. A trusted operator runs `npm run provision -- /private/new-directory` **on a local computer**, verifies both intended devices, and transfers each device's own JSON file through a private authenticated channel (local cable, or an authenticated encrypted device-to-device transfer). Never host device JSON/QR files on the relay, email them unencrypted, put them in analytics, or paste them into chat/issue trackers. The generator creates a new directory with mode 0700 and files 0600 and refuses to overwrite an existing directory. Filesystem permission bits are not a substitute for disk security or authenticated transport.

Generated artifacts:

| File | Destination | Contents |
|---|---|---|
| `android.json` | Android Keystore-encrypted preferences | Android token, shared pair ID/key ID, AES key |
| `iphone.json` | iOS shared Keychain | iPhone token, shared pair ID/key ID, same AES key |
| `server.env` | Railway variables | Pair IDs, public key IDs, SHA-256 device hashes, metrics token hash; **no decryption key or device token** |
| `metrics.json` | Operator only | Raw metrics credential |

Devices must receive different bearer credentials even though they share their pair's encryption key. Hashes are safe to deploy; the raw secrets are generated from 32 cryptographically random bytes and compared using constant-time fixed-size digest comparisons on the server. The server checks all configured credentials for the required role, limits registry size and refuses reused hashes across roles/pairs. A low-entropy manually chosen token is unsafe even when hashed; use the generator.

For additional pairs, generate a **new directory**, append that directory's single pair object to the existing registry array, and preserve the existing metrics hash/token. Do not replace the registry with just the new pair or accidentally share a credential across pairs. Redeploy and privately provision the new devices. This intentionally simple operator-managed registry supports up to 100 pairs; an automated pairing service is a future feature.

The local `provisioning/` directory, `.env`, and generated secrets are Git-ignored and excluded from the Docker build context. If a different output location is used inside the repository, add it to both ignore files before generating secrets. Keep necessary backups in a protected credential store; securely delete transient transfer copies. The deployment build copies only source/build artifacts and npm packages into the runtime.

## Wire protocol v1

Android sends a raw UTF-8 ASCII code containing 4–32 characters from `[A-Za-z0-9]`. There is no numeric conversion, normalization, case folding or whitespace trimming of decrypted content. AES-256-GCM parameters:

- Key: 32 random bytes provisioned directly between trusted devices.
- Nonce: fresh 12 random bytes for **each newly encrypted message under a key**; never intentionally reuse.
- Tag: 16 bytes, separate from the ciphertext in JSON.
- Encoding: all binary values use unpadded canonical base64url (`-` and `_`).
- Ciphertext length: same as plaintext, 4–32 bytes.
- Key ID: public opaque version identifier from the pair registry. It is not a secret or encryption key.

Additional authenticated data (AAD) is **the UTF-8 encoding of this compact JSON array**, no extra spaces, escaping of `/`, newline or byte-order mark:

```text
["otp-relay/v1","PAIR_UUID","MESSAGE_UUID","android","UTC_TIMESTAMP_WITH_3_FRACTIONAL_DIGITS","KEY_ID"]
```

UUIDs use lowercase canonical representation. Timestamp uses exactly `YYYY-MM-DDTHH:mm:ss.SSSZ`. Pair ID is resolved from the Android credential on the server and configured on both devices; clients never select another pair through a query/body field. Android and Swift explicitly produce the same AAD bytes. `scripts/encrypt-example.mjs` is an executable Node reference using **only synthetic codes**. The protocol uses standard platform AES-GCM APIs; it is a shared-key design, not a new key agreement protocol.

The server validates size, algorithm, base64url and allowed key ID but cannot validate plaintext semantics or authentication tags without violating E2E encryption. The iPhone rejects a mismatched key, invalid tag, wrong AAD, malformed code or expired payload. It caps lifetime independently to 90 seconds after authenticated `receivedAt`, and rejects times more than ten seconds in the future. Keep mobile and server clock-skew policies aligned if changing the server default. `expiresAt` is server metadata; the authenticated receive timestamp prevents trusting an arbitrarily extended expiry.

The server still sees timing, length, pair IDs, message IDs and incoming bearer credentials in memory. It cannot hide traffic patterns or prevent a compromised authorized phone from accessing that pair's secrets. There is no cryptographic protection against a compromised endpoint. A malicious relay could withhold or replay ciphertext within its validity window; devices must check authenticated timestamps and clear cached selections on consumption. End-to-end encryption protects the OTP contents from the server, not availability.

## Idempotency and replay protection

Redis TIME governs the accepted timestamp window. Uploads must not be older than the configured OTP TTL or more than the clock-skew allowance in the future. Effective expiry is the earlier of server acceptance time + TTL and Android receive time + TTL. Old network retries cannot grant a fresh lifetime.

Per-pair Lua operations serialize a latest payload, message-ID fingerprint receipts and nonce guards in one atomic operation. The hash fingerprint is over a canonical validated envelope. Exact duplicates are acknowledged without writing, extending TTL, publishing or resurrecting consumed payloads. Changing a message ID's content or using a recently seen key/nonce under a new ID is rejected. An upload older than the currently pending message is rejected. Only the latest ciphertext is retained; replaced payloads disappear immediately, while minimal receipts remain until expiry.

A consume operation matches both pair and message ID, deletes the payload and marks its receipt consumed while retaining the receipt's existing TTL. Repeated acknowledgement returns success only while the consumed receipt exists. Stale consumption cannot delete a replacement code. A response already returned by a GET cannot be cryptographically recalled; mobile cache clearing/expiry checks remain necessary.

Receipts and nonce guards live TTL + 2 × skew (110 seconds by default), not forever. Random 96-bit nonces are still mandatory: a bounded replay cache cannot make deliberate nonce reuse safe after it expires. Preserve the original exact envelope on retries; never re-encrypt the same logical message with an old nonce or assign a new timestamp to it. A stolen bearer token could submit fresh malicious data; revoke it immediately.

Redis must use `noeviction`, since early eviction of replay records defeats their retention period. Failures return 503 rather than switching to process-local data. A write might commit before a lost/timed-out response; retry identically. Shared Redis is a dependency, not a highly available guarantee. Do not silently restore old database backups into a live namespace: use a fresh namespace/pair keys after an uncertain rollback and review pending/replay state.

## Credential and encryption-key rotation

For a device token:

```bash
node scripts/credential.mjs /private/path/new-device-credential.json
```

1. Add its `sha256` value as the second hash for the intended pair and role. Deploy and wait for all replicas to update.
2. Privately replace **only that device's token** in its pairing JSON; retain its pair ID, key ID and encryption key. Reimport/save on that device and verify access.
3. Remove the old hash, deploy and wait for old replicas to drain. Remove transport copies.

Both overlapping credentials share a pair/role rate budget. Rotate metrics credentials by changing `METRICS_TOKEN_HASH` and the operator's token; that field has no overlap array. Emergency revocation removes a role's compromised hash (provision a replacement first so configuration remains valid) or removes a compromised pair. At least one pair must remain in the registry; otherwise stop the service. Revocation is complete only after all old deployments stop serving.

For encryption-key rotation, prefer provisioning a **fresh pair** and switching both phones, which also abandons old pending codes until their TTL expires. An advanced client may keep old/new local keys during a transition and configure both public `keyIds`; this simple mobile example stores one active key and does not implement an old-key keyring. A key ID alone is insufficient; privately transfer the new actual key to both phones. Do not put decryption keys in server variables to simplify migration.

## Operational privacy

Production requires trusted HTTPS termination. Only the nearest Railway proxy hop is trusted; expose the public domain through that ingress and protect private listener access. Authorization is header-only and route-scoped. Native clients disable redirects; no permissive CORS or cookies are used. Request bodies are bounded, strict and never logged.

Health responses include no secrets. Logs have safe route templates, random server request IDs, timing/status and event names. Redis error objects/URLs and validation details never appear in logs/errors. The metrics route uses an independent credential. Timing based on client clocks is diagnostic, not a trustworthy SLA measurement.

Redis TTL and DEL provide logical invalidation. RDB/AOF files, infrastructure snapshots and backups may retain ciphertext after deletion; disable persistence/backups where appropriate or define retention. No historical OTP store is implemented. Runtime state is never written to the application container filesystem.
