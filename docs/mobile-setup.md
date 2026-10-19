# Mobile source integration

These are source examples, not complete signed APK/IPA projects. Both clients use only the new `/api/v1` encrypted protocol. Legacy raw token settings must be replaced with generated pairing JSON. Test only on devices/accounts you control.

## Android

1. Create an Android Studio Empty Views Activity project, package `com.example.otprelay`, Kotlin, minimum SDK 26+. Copy all Kotlin files from `android/app/src/main/java/com/example/otprelay/` to your package and merge the provided manifest.
2. The manifest requires INTERNET and RECEIVE_SMS, disables cleartext HTTP and backup, and accepts the system SMS broadcast under `BROADCAST_SMS`. Keep consent and Google Play SMS permission requirements in mind. This is a visible personal relay feature, not a hidden SMS collector.
3. Run the app. Enter your Railway public **HTTPS** URL with no query/fragment/path, privately paste the generated `android.json`, enter exact comma-separated allowed sender IDs, enable forwarding, save, and grant SMS permission. A blank pairing field retains a previously saved pairing. Pairing material is wrapped with Android Keystore AES-GCM before being stored in private preferences. Do not include it in screenshots or clipboard history.
4. Send a synthetic mixed-case test such as `Ab7Cd9Ef2G`. The upload encrypts the exact UTF-8 string using the paired AES key and fresh GCM nonce, creates one UUID/timestamp, and sends only encrypted code and metadata. It disables redirects and uses a bounded upload queue and connection/read deadlines.
5. Test an SMS from an explicitly approved sender. `OtpExtractor.extractApproved` checks exact sender identity before extracting. The explicit `OTP is` format supports 4–10 letters/digits containing at least one digit and preserves their case. It excludes 11-character SMS Retriever hashes and rejects malformed/ambiguous explicit candidates. Only numeric 4–8 digit fallback extraction is allowed outside that explicit format. Multiple candidate numbers require a service-specific parser rather than guessing.
6. Background delivery is subject to Android process and SMS delivery rules. The source uses a bounded executor, not durable encrypted retries. A production mobile app should keep a broadcast `goAsync()` pending result for bounded immediate work and/or hand off to properly scoped WorkManager work with encrypted storage, original envelope reuse, TTL and bounded backoff. It must never postpone an OTP beyond its expiry or collect every SMS. Physical-device testing is required.

The manual test field permits `[A-Za-z0-9]{4,32}`; automatic SMS extraction deliberately uses the narrower rules above. To expand a service's format, add an explicit allowlisted parser with synthetic tests. Do not use arbitrary alphanumeric matching: a hash or another message token can resemble an OTP.

Run pure JVM tests with a JDK and Kotlin CLI compiler:

```bash
scripts/test-android-extractor.sh
# Or KOTLINC=/absolute/path/to/kotlinc scripts/test-android-extractor.sh
```

The tests execute actual `OtpExtractor.kt`, use only synthetic codes, and print just a case count. They cover the Easypaisa example, case, leading zeros, numeric formats, hashes, ambiguity and sender allowlists.

## iPhone app and Credential Provider Extension

1. Create an iOS SwiftUI App project `OTPRelay`, minimum iOS 18. Add `ios/OTPRelay/*.swift` to the application target.
2. Add a Credential Provider Extension target `OTPProvider`. Replace its controller with `ios/OTPProvider/CredentialProviderViewController.swift`.
3. Add **both** files under `ios/Shared/` (`RelayClient.swift`, `RelayPayload.swift`) to **both** targets. They use Foundation, Security and CryptoKit; there are no third-party crypto libraries.
4. Merge the provided extension Info.plist dictionary. In particular set `ASCredentialProviderExtensionCapabilities > ProvidesOneTimeCodes = YES`.
5. Enable **AutoFill Credential Provider**, **App Groups**, and **Keychain Sharing** on both targets. Change `RelayConfig.appGroup` to your App Group; replace `YOUR_TEAM_ID` and keychain group to match the full signed access group on both targets. Automatic signing may prefix it with the App Identifier Prefix.
6. Build/sign on a physical iPhone. Enter the HTTPS root URL with no path/query/fragment/credentials. Privately paste `iphone.json` into the secure pairing field and save. The pairing (token and decryption key) is held in the shared Keychain with `AfterFirstUnlockThisDeviceOnly`. The URL is stored in the App Group preferences. Empty pairing input keeps the saved pairing.
7. Use **Fetch latest OTP** with a fresh synthetic upload to verify exact case. This explicit test UI shows the code; production telemetry must not capture UI content. No code or pairing material is printed/logged by the client.
8. Enable the OTPRelay provider in Settings → General → AutoFill & Passwords (setting labels can vary by iOS version). In a compatible OTP input, open the provider, then explicitly select **Fill**. Use Safari `autocomplete="one-time-code"` or a UIKit `.oneTimeCode` field for validation.

The extension immediately GETs the latest ciphertext, authenticates AES-GCM against the exact pair/message/time/key AAD, validates expiry and characters, and passes **the original string** to `ASOneTimeCodeCredential(code:)`. It never parses an integer or changes case. It checks expiry again when Fill is tapped. The system decides whether a compatible field exposes the provider; no inline suggestion or automatic bypass is guaranteed. The current chooser uses the latest code rather than service-aware matching; retain explicit selection and add service context/confirmation before broader deployment.

After AutoFill completes, the controller requests consumption in the callback unless the system marks the background callback expired. This acknowledges user selection, not successful authentication by the destination app/service. The network request is best effort because iOS can terminate extension execution. For reliable retries, persist **only the selected message ID** securely in the App Group, retry from the containing app, and clear local code caches. Never consume solely on fetching the chooser. Server TTL remains a fallback if acknowledgement is interrupted.

The shared URLSession disables redirects, caching, cookies and credential storage. Immediate reads use a five-second timeout. The complete foreground app can add the authenticated long-poll route (25-second wait, ≥30-second client timeout), with cancellation/backoff and cache invalidation; do not run that wait indefinitely inside the extension. APNs is not implemented. Any later APNs integration must send only an opaque hint, and silent push cannot guarantee prompt wake-up.

## Local Swift verification

On a Mac with Swift/CryptoKit:

```bash
scripts/test-ios-payload.sh
```

These compiled Swift tests check exact mixed-case/leading-zero decryption, expiry, AAD tampering and empty responses, with synthetic data only. The entire provided Swift source can be typechecked against an installed iOS Simulator SDK, but this is not a substitute for a signed app, capability verification or physical-device AutoFill tests. Record those separately, along with end-to-end SMS timing.

Official interfaces: [Apple's AutoFill OTP guide](https://developer.apple.com/documentation/authenticationservices/providing-one-time-passcodes-to-autofill), [AutoFill completion callback semantics](https://developer.apple.com/documentation/authenticationservices/ascredentialproviderextensioncontext/completeonetimecoderequest(using:completionhandler:)), [Google's 11-character SMS Retriever hash format](https://developers.google.com/identity/sms-retriever/verify).
