# Live deployment and local mobile builds

Public backend: **https://otp-relay-production-a3b3.up.railway.app**

Railway project: [OTP Relay](https://railway.com/project/8793af91-5376-4fcf-a4fc-3a6236ee60ec?environmentId=550aa245-7ea9-4ae7-a114-ac5efa00416c). The backend and Redis deployed successfully in Singapore. The workspace member list contained one account when checked on 19 October 2026; no members were invited. The repository on GitHub is public, so source code should not be assumed undiscoverable.

## Actual deployment configuration

- Source: `acefolioDev/otp-relay`, branch `main`, root Dockerfile, production `node dist/server.js`.
- Backend: one replica in `asia-southeast1-eqsg3a`, `NODE_ENV=production`, port 3000, health check `/ready`, timeout 30 seconds, failure restart up to 10 retries, 10-second draining period, serverless sleeping disabled.
- Redis: same region, password-protected private networking only, no public TCP proxy, 128 MB `maxmemory`, `noeviction`, RDB saves disabled and AOF disabled. The provisioned volume is not used for OTP persistence with this command.
- Backend `REDIS_URL` references `${{Redis.REDIS_URL}}`; no Redis password was copied into source or documentation.
- Device credentials are configured as the generated SHA-256 hashes; encryption keys remain local in protected provisioning files. Separate metrics credential hash is configured. Public OTP routes require their intended role credential.
- Default quotas remain 120 Android and 600 iPhone requests/minute per pair, OTP TTL 90 seconds, skew allowance 10 seconds. No load-test quota increase was applied to production.

Railway's current UI reports that legacy Config as Code is deprecated and new services cannot opt into it. **This service was configured through Railway's settings**, with Dockerfile autodetection. The checked-in `railway.json` is a validated legacy reference, not a substitute for verifying new-service settings. Use the explicit settings above or Railway's supported Infrastructure as Code for a new deployment.

## Live verification

`node scripts/verify-deployment.mjs` passed against the real public HTTPS service. It verifies health, Redis readiness, authentication rejection, encrypted mixed-case upload, exact duplicate acknowledgement, local decryption, atomic consumption, repeated consumption and empty retrieval. It writes only timing/status information to [deployment-verification.json](deployment-verification.json). `scripts/test-ios-live.sh` also fetched/decrypted/consumed a synthetic code using the actual shared Swift payload decoder over HTTPS.

The initial live sample measured server processing of 8.42 ms for upload, 4.48 ms for retrieval and 4.16 ms for consumption, with HTTP round trips around 120–126 ms after connection setup. These are individual observations, not production p95 statistics or an end-to-end phone delivery claim. The latest safe report is authoritative if rerun results differ.

## Mobile projects

Both complete build projects have the actual HTTPS URL preconfigured:

- Android: `android/`, application ID `com.acefolio.otprelay`, namespace `com.example.otprelay`, minimum SDK 26, compile/target SDK 36. Import only your private `provisioning/android.json` through the app's file picker or secure paste field. Exact sender allowlist and explicit forwarding switch remain required.
- iOS: `ios/OTPRelay.xcodeproj`, scheme `OTPRelay`, bundle ID `com.acefolio.otprelay`, extension `com.acefolio.otprelay.OTPProvider`, minimum iOS 18. Import only `provisioning/iphone.json` through the app's file picker. The foreground listener uses authenticated long polling, cancels when inactive, backs off after errors and keeps immediate extension GETs independent. Consumption acknowledgements retain only ID/expiry for foreground retries; no plaintext code is written to preferences.

No actual tokens or AES keys are embedded in either binary or committed. Your private provisioning files already match the deployed registry. The app does not need the Android token, and Android does not need the iPhone token.

Build locally:

```bash
android/gradlew -p android assembleDebug testDebugUnitTest lintDebug
xcodebuild -project ios/OTPRelay.xcodeproj -scheme OTPRelay -configuration Debug \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath ios/build \
  CODE_SIGN_IDENTITY=- CODE_SIGNING_REQUIRED=NO DEVELOPMENT_TEAM= AppIdentifierPrefix=LOCAL. build
```

The Android wrapper pins Gradle 8.14.3 with its official distribution checksum. Requires JDK 17 and installed Android SDK 36 (`ANDROID_HOME` or an ignored `android/local.properties`). The Xcode project is committed; regenerate with `xcodegen generate --spec ios/project.yml` only after changing the project specification.

Local artifacts are ignored by Git:

- `artifacts/OTPRelay-debug.apk`: debug-signed Android installable APK.
- `artifacts/OTPRelay-simulator.app.zip`: local Simulator app containing the credential provider extension; **not an iPhone IPA**.

The app was installed and launched in the local iPhone Simulator. Simulator signing uses `LOCAL.` and the ad-hoc “Sign to Run Locally” identity. **No work signing team was selected and no Apple Developer portal updates were requested.** Mobile source/build changes remain local as requested. Installing on an actual iPhone still requires your own Apple Developer signing setup and compatible entitlements. Using a work team can create records visible to its administrators, so no secrecy guarantee is made for that path.

## Local connection test

With the iPhone app paired and listening in Simulator, run:

```bash
node scripts/upload-synthetic.mjs
```

This sends only a freshly encrypted synthetic mixed-case code using local provisioning material. Fetch/select it in the app within 90 seconds; never use this script to process real SMS or expose real codes in a shell command. Native shared-client verification instructions are in [mobile setup](mobile-setup.md).

Actual Android SMS reception → physical-iPhone AutoFill selection remains unmeasured. Automatic sender forwarding stays off until you configure exact approved sender IDs locally. Android background work is bounded but not durably retried across process loss; APNs is not implemented or required for authenticated retrieval. The current chooser uses explicit selection and latest-code behavior; service-aware confirmation is still recommended before broader distribution.
