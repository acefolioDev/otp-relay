# Verification — 19 October 2026

## Initial backend checks actually executed

Environment: local macOS x86_64, Node.js v22.23.1 / npm 10.9.8, real Redis 7.4.7 built locally and bound to loopback. Docker CLI was available but its daemon was not running, so no container image build was performed. The published Railway JSON schema was downloaded and used for configuration validation; this does not assert a successful Railway build/deployment.

| Check | Actual result |
|---|---|
| `TEST_REDIS_URL=redis://127.0.0.1:16379 REQUIRE_REDIS_TESTS=true npm test` | **35 tests passed**, 4 files, zero skipped/failures |
| `npm run typecheck` | Passed, including test source |
| `npm run build` | Passed, compiled production JavaScript |
| `npm audit` and `npm audit --omit=dev` | Zero reported vulnerabilities |
| Built server live HTTP smoke | Health, ready, invalid auth, encrypted upload, exact-case decryption, consumption and empty retrieval passed |
| Built server SIGTERM | Graceful shutdown exited 0 |
| Built server with unavailable Redis | Failed closed, exited 1 within bounded startup deadline |
| Published Railway schema vs `railway.json` | Validation passed using AJV draft 2020-12 |
| `scripts/test-android-extractor.sh` | 29 synthetic extraction/allowlist cases passed, plus Node/Kotlin AES-GCM interoperability vector |
| All supplied Android Kotlin sources compiled against Android API 36 | Passed using Kotlin CLI 2.2.21 and installed Android SDK |
| `scripts/test-ios-payload.sh` | 17 compiled Swift payload tests passed, including Node/Swift interoperability |
| All supplied iOS Swift sources typechecked against iOS Simulator SDK | Passed, Swift 6.2, iOS 18 deployment target |

Backend tests cover encrypted and development compatibility uploads, numeric/mixed-case preservation, wrong/missing/rotated credentials, expiration, deduplication and tampered retries, timestamp/nonce replay, delayed-message ordering, schema/body limits, cache prevention, consumption and repeat acknowledgements, pair isolation, concurrent operations, quota enforcement, safe logging, HTTPS/origin policy, readiness/outage handling, telemetry, long-poll timeout/cap/draining, and Pub/Sub wakeups/rate limits across two backend instances.

The deterministic public vector in `tests/fixtures/encryption-vector.json` contains intentionally fixed **synthetic test** key/nonce/token values. The actual upload encryption helper in Kotlin produces the same ciphertext/tag as Node, and the shared iOS decoder decrypts Node's envelope without changing case. These fixed vector values are never used by provisioning or production.

Mobile compilation/typechecking does not create signed APK/IPA artifacts or verify physical-device SMS/AutoFill behavior. CI checks the backend with real Redis; mobile CLI tests need their platform toolchains locally.

## Recorded local load sample

Raw results: [benchmarks/local.json](benchmarks/local.json).

A **five-second**, single-worker lifecycle workload issued fresh encrypted POST → latest GET → consume cycles over reused HTTP connections to a locally running production JavaScript build, using actual loopback Redis. Logging was `info`; test-only rate quotas were increased to 100,000/minute so they did not dominate this performance sample. Other local verification work ran on the same host. There was no separate warm-up phase or production network/TLS path.

| Route | Requests | Mean ms | p50 ms | p95 ms | p99 ms | HTTP/network errors |
|---|---:|---:|---:|---:|---:|---:|
| Upload | 1,906 | 0.898 | 0.829 | 1.264 | 2.218 | 0 |
| Latest | 1,906 | 0.687 | 0.640 | 1.013 | 1.460 | 0 |
| Consume | 1,906 | 0.846 | 0.768 | 1.186 | 1.821 | 0 |

Overall measured throughput was **1,143.38 HTTP requests/second**, or 381.13 complete lifecycle cycles/second, with **0% HTTP/network error rate**. Each route's rate over the total test duration was 381.13 requests/second. These are short-run loopback measurements, not sustainable capacity or Railway performance claims. Client encryption occurs before the POST latency timer; all cycle work contributes to total throughput.

Long polls deliberately include waiting and were tested functionally, not included in this immediate-route latency sample. Their telemetry is marked separately from immediate GETs. The local sample meets the immediate-route p95 <200ms goal in this narrow environment; regional latency, Redis contention, quotas, cold starts and realistic multi-pair concurrency still need testing after deployment.

## Subsequent deployment and mobile verification

The backend has now successfully deployed on Railway at **https://otp-relay-production-a3b3.up.railway.app**. Both backend and private Redis run in Singapore; Railway built the actual Docker image and its `/ready` gate passed. [Safe live HTTP timings/statuses](deployment-verification.json) and [deployment settings](deployment.md) document the result.

Additional executed checks:

- Deployed API smoke: HTTPS, health, Redis readiness, unauthenticated rejection, ciphertext upload, deduplication, exact-case local decryption, consumption, repeated consumption and empty retrieval all passed.
- Native Swift HTTPS smoke using the actual shared decoder: passed.
- Android Gradle `assembleDebug testDebugUnitTest lintDebug`: passed; **5 JUnit tests**, **0 lint errors**, 2 toolchain/target-version advisory warnings. Debug APK created locally.
- Xcode app plus embedded AutoFill extension build: passed with **Sign to Run Locally**, empty development team and `LOCAL.` Simulator signing prefix. Simulator app installed and launched successfully.
- Hosted iOS Simulator XCTest using the actual app's shared Keychain, shared `RelayClient`, real Railway HTTPS, exact-case decryption and consumption: **1 test passed, 0 failures**, test body 0.858 seconds. This is a synthetic local-app test, not SMS-to-AutoFill delivery timing. Reproduce with `scripts/test-ios-client-live.sh` on a booted Simulator and the private local pairing files.
- Backend Vitest re-run after mobile changes: **35 tests passed**, 4 files; build, typecheck, 17 Swift payload tests, 29 Kotlin extractor cases and the Kotlin crypto vector all passed again.

No actual credential or AES key is embedded in the APK, Simulator app or committed source. Temporary Simulator import JSON was removed after Keychain import. Mobile changes and artifacts remain on this Mac under the user's local-only privacy instruction. No work signing team was used, no Apple Developer provisioning updates were requested, and no physical-device installation was performed.

## Not performed

- Physical-device signed iPhone installation or real SMS reception/AutoFill testing.
- APNs integration/background delivery measurement.
- A measured Android SMS → iPhone AutoFill result under 15 seconds.

Backend deployment and local mobile integration are complete. The next physical-device phase requires your own Apple signing setup and exact approved SMS sender IDs; see [deployment and mobile handoff](deployment.md).
