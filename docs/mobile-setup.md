# Mobile setup with the live backend

Both build projects use **https://otp-relay-production-a3b3.up.railway.app** by default. Actual private device pairing files are kept in the ignored `provisioning/` directory; do not embed them in source, APKs, app bundles or Git. Each file matches the credential hashes already configured on Railway.

## Android

Open the `android/` directory in Android Studio, or build with:

```bash
android/gradlew -p android assembleDebug testDebugUnitTest lintDebug
```

Requirements: JDK 17, Android SDK 36 and either `ANDROID_HOME` or an ignored `android/local.properties` containing `sdk.dir=/your/sdk/path`. The wrapper pins Gradle 8.14.3 and an official distribution checksum. The application ID is `com.acefolio.otprelay`, namespace `com.example.otprelay`, min SDK 26. `artifacts/OTPRelay-debug.apk` is the built local debug APK. Nothing was installed on a physical phone during the local-only phase.

On your Android when ready:

1. Install the APK, open it and confirm the preconfigured HTTPS URL.
2. Use **Import private pairing file** to select your private `android.json`, or paste it into the secure field and save. The file is bounded to 4096 bytes, role/key/token validated and wrapped by Android Keystore AES-GCM in private preferences. Screenshots and backups/device transfers of this app’s data are disabled. The app never uploads full SMS bodies.
3. Enter exact approved sender IDs, then explicitly enable forwarding, save and grant SMS permission. Forwarding is off until configured; denying permission turns it off. The allowlist checks exact sender identity before extraction. Sender names can still be spoofed by telecom senders, so this controls forwarding scope rather than authenticating the service.
4. Use a synthetic code to test encryption and backend access. Automatic extraction takes the exact token immediately after `OTP is`, preserves case/leading zeros, accepts 4–10 letters/digits with at least one digit and refuses 11-character SMS Retriever hashes. Numeric fallback is 4–8 digits and rejects multiple candidate numbers. Manual upload/API support 4–32 letters/digits.

Example: `Your easypaisa mobile account registration/login OTP is Ab7Cd9Ef2G OTP aur PIN ko mahfooz rakhein` extracts exactly `Ab7Cd9Ef2G`. There is no bare alphanumeric scanner or automatic forwarding without approved senders.

The receiver uses `goAsync()` with a nine-second pending-result deadline, bounded upload queue, timeouts and fresh AES-GCM nonces. It is not a durable WorkManager retry system; a killed process or special SMS Retriever routing can still prevent delivery. For background reliability beyond this local integration, persist retries encrypted, preserve the exact original envelope and expire them within TTL. SMS permissions also require review for any Play Store distribution.

The CLI extractor tests run actual Kotlin and the shared Java AES helper with synthetic data:

```bash
scripts/test-android-extractor.sh
# Set KOTLINC=/absolute/path/to/kotlinc if needed.
```

## iOS app and AutoFill extension

Open `ios/OTPRelay.xcodeproj`, scheme **OTPRelay**. No project creation is needed. Both the app and OTPProvider extension include Shared source, CryptoKit decryption, App Group/Keychain Sharing and AutoFill entitlements; `ProvidesOneTimeCodes` is enabled. Bundle IDs are `com.acefolio.otprelay` / `com.acefolio.otprelay.OTPProvider`, minimum iOS 18.

Build on this Mac without using a work team:

```bash
xcodebuild -project ios/OTPRelay.xcodeproj -scheme OTPRelay -configuration Debug \
  -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath ios/build \
  CODE_SIGN_IDENTITY=- CODE_SIGNING_REQUIRED=NO DEVELOPMENT_TEAM= AppIdentifierPrefix=LOCAL. build
xcrun simctl install booted ios/build/Build/Products/Debug-iphonesimulator/OTPRelay.app
xcrun simctl launch booted com.acefolio.otprelay
```

This uses ad-hoc **Sign to Run Locally** and a `LOCAL.` shared-Keychain prefix. No physical device or Apple Developer portal provisioning is performed. The built ZIP is a Simulator `.app`, not a physical-iPhone IPA. The Xcode project is committed; `ios/project.yml` is the source for regeneration with XcodeGen.

In the app, import `provisioning/iphone.json`, confirm the HTTPS URL and fetch a fresh synthetic upload. Import uses a security-scoped file picker; pairing is stored in shared Keychain with `AfterFirstUnlockThisDeviceOnly`. No raw token/key is printed. Optional foreground listening uses 25-second authenticated long polling with cancellation on inactivity and jittered reconnection, not repeated short GET polling. The app hides an expired displayed code and lets you explicitly mark a selected test code used.

The extension immediately fetches, authenticates GCM against pair/message/source/timestamp/key AAD, checks expiry and passes the **original string** to `ASOneTimeCodeCredential(code:)` after explicit selection. It never parses an integer or changes case. Refresh cancels stale requests and generation checks prevent an old response overwriting a newer one. Consumption queues only ID/expiry for foreground retries; no plaintext code is put in preferences. Extension execution can end before acknowledgement finishes, so TTL remains the final boundary.

For a real iPhone later, use **your own** Apple Developer signing setup. Set `DEVELOPMENT_TEAM` and register the app/extension IDs and `group.com.acefolio.otprelay`, with matching AutoFill, App Group and shared Keychain capabilities. Physical Keychain prefixes expand from your personal signing profile; they are not `LOCAL.`. Work signing teams can expose provisioning records to administrators; this local project does not attempt to hide activity from a signing team. Enable your provider under iOS AutoFill settings and test a compatible field such as Safari `autocomplete="one-time-code"`. The system controls provider availability and suggestion presentation.

The chooser uses the latest code with explicit selection. Service-specific confirmation/matching is a remaining hardening task before broader distribution. APNs is not implemented; it must never be required for valid authenticated GET retrieval.

## Verification

```bash
scripts/test-ios-payload.sh          # compiled Swift, synthetic fixture only
scripts/test-ios-live.sh             # actual HTTPS fetch/decryption/consume, private local pairing
scripts/test-ios-client-live.sh      # hosted Simulator test of actual shared Keychain/network client
node scripts/verify-deployment.mjs   # full deployed API smoke, safe status/timing report
node scripts/upload-synthetic.mjs   # fresh synthetic encrypted code for the paired app
```

A hosted Simulator test target `OTPRelayIntegrationTests` also exercises the actual shared `RelayClient`, local shared Keychain and live HTTPS service. It skips unless `relay-private-test.json` is staged in the app’s private Documents directory. The test deletes that temporary import file after saving pairing to the local Simulator Keychain. It contains no real SMS and logs no code/credential. Build-for-testing first, upload a fresh synthetic code, then execute test-without-building before its 90-second expiry. The latest executed result is recorded in [verification](verification.md).

Physical Android SMS → iPhone AutoFill selection and the <15-second target remain unmeasured. Configure approved sender IDs and personal phone signing when you are ready for that phase.

Official references: [Apple AutoFill OTP guide](https://developer.apple.com/documentation/authenticationservices/providing-one-time-passcodes-to-autofill), [completion callback semantics](https://developer.apple.com/documentation/authenticationservices/ascredentialproviderextensioncontext/completeonetimecoderequest(using:completionhandler:)), [Google SMS Retriever hash format](https://developers.google.com/identity/sms-retriever/verify).
