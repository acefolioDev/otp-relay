# Install OTP Relay on your iPhone

Use Xcode on your Mac to install the app and its bundled AutoFill extension directly on your iPhone. The backend URL is already configured:

**https://otp-relay-production-a3b3.up.railway.app**

There is currently no App Store or TestFlight download. `artifacts/OTPRelay-simulator.app.zip` runs only in the Mac's iOS Simulator; it cannot be installed on an iPhone. Physical-device installation and AutoFill still need to be verified on your phone.

## 1. What you need

- An iPhone running **iOS 18 or later**, with internet access.
- A Mac with Xcode that supports the iOS version installed on your phone.
- A USB cable for the initial connection.
- Your **own Apple developer signing account**, with access to the App Groups, Keychain Sharing and AutoFill Credential Provider capabilities this project uses.
- The existing private `provisioning/iphone.json` file on this Mac. Keep the matching `provisioning/android.json` on the Mac for the synthetic test below.

Apple limits capabilities according to developer membership. A free account appears as **Personal Team** in Xcode and may not support the full app/extension configuration. If Xcode rejects the required capabilities, use your own compatible Apple Developer Program membership; do not remove the entitlements to bypass the error. See [Apple's account and membership explanation](https://developer.apple.com/help/account/basics/about-your-developer-account) and [adding capabilities](https://developer.apple.com/documentation/xcode/adding-capabilities-to-your-app).

For your local personal setup, select only an account/team you own. Using a company or client team creates signing/provisioning records in that team's account; keeping the source on your Mac does not make those records private from that team. This guide does not require uploading the app to App Store Connect, enabling Xcode Cloud, or pushing your changes to GitHub.

## 2. Open the project and choose your account

1. In Finder, open this repository's `ios` folder, then double-click **OTPRelay.xcodeproj**. The project is included; XcodeGen is not needed to open it.
2. Open **Xcode → Settings → Apple Accounts** (called **Accounts** in some versions), and add your own Apple Account if needed.
3. Click the blue **OTPRelay** project icon in the left sidebar.
4. Under **TARGETS**, select **OTPRelay**, then **Signing & Capabilities**.
5. Enable **Automatically manage signing** and select your own **Team**.
6. Repeat for the **OTPProvider** target, using the same team.

Signing is separate from your iPhone's iCloud login; you do not need to sign out of iCloud. Apple documents the Xcode account and team setup in [running on physical devices](https://developer.apple.com/documentation/xcode/running-your-app-on-simulated-or-physical-devices).

## 3. Check identifiers and shared capabilities

The app and extension must share their settings and private pairing. Both targets need matching App Group and Keychain access.

| Setting | Included value | What to do |
|---|---|---|
| App bundle identifier | `com.acefolio.otprelay` | Keep it if your team can register it; otherwise choose your own unique identifier. |
| Extension bundle identifier | `com.acefolio.otprelay.OTPProvider` | If changing the app identifier, use the same new prefix plus `.OTPProvider`. |
| `RELAY_APP_GROUP` | `group.com.acefolio.otprelay` | Use an App Group registered to your own team, identical for both targets. |
| `RELAY_KEYCHAIN_SUFFIX` | `com.acefolio.otprelay.shared` | Keep identical for both targets. |
| `RELAY_SIGNING_PREFIX` on iPhone | `$(AppIdentifierPrefix)` | Let the actual signing profile supply this prefix. |

If you need a different App Group, select the **project** (under PROJECT, rather than TARGETS), open **Build Settings**, choose **All**, search for `RELAY_APP_GROUP` and change it for both Debug and Release. For example, use `group.com.yourname.otprelay` with your own unique name. The included entitlement and Info.plist files use this setting. In each target's **Signing & Capabilities → App Groups**, register/select that same group for your personal team. See [Apple's App Groups instructions](https://developer.apple.com/documentation/xcode/configuring-app-groups).

In **both targets**, verify that **AutoFill Credential Provider**, **App Groups**, and **Keychain Sharing** are present. The resolved Keychain group must be the same in both: `$(AppIdentifierPrefix)$(RELAY_KEYCHAIN_SUFFIX)`. The signing prefix is not necessarily the same as your Team ID; leave it profile-derived.

Do not copy the Simulator build's `LOCAL.` prefix, `CODE_SIGNING_REQUIRED=NO`, or ad-hoc signing overrides into an iPhone build. Use Xcode's automatic development signing. If you later regenerate the project with XcodeGen, mirror your local identifier/settings changes in `ios/project.yml` first.

## 4. Connect your iPhone and install

1. Connect your iPhone to the Mac with USB and unlock it.
2. If the phone asks **Trust This Computer?**, tap **Trust** and enter your passcode.
3. In Xcode, open **Window → Devices and Simulators** and wait for your phone to finish pairing/preparation.
4. On the iPhone, open **Settings → Privacy & Security → Developer Mode**, enable it, restart when prompted, then confirm enabling it after restart. If the option is missing, connect/pair with Xcode first. See [Apple's Developer Mode guide](https://developer.apple.com/documentation/xcode/enabling-developer-mode-on-a-device).
5. In Xcode's top toolbar, select scheme **OTPRelay** and choose **your physical iPhone** as the run destination.
6. Click **Run ▶** or press **⌘R**. Allow Xcode to register your device with your own developer account if prompted.
7. Wait for the build and installation to complete. **OTP Relay** should open on the phone. The **OTPProvider** extension installs with the app; do not install or run it separately.

If iOS specifically asks you to trust your developer identity, follow its prompt under **Settings → General → VPN & Device Management** and trust only your own signing identity. Xcode may complete this without a separate trust prompt.

## 5. Import your private iPhone pairing

1. On the Mac, find `provisioning/iphone.json` inside this repository. It contains a private credential and decryption key, so do not print it in logs, commit it, or share it publicly.
2. Transfer **only this iPhone file** privately to your own phone, for example using AirDrop. Save it somewhere the Files picker can access, preferably **On My iPhone**. If needed, use the receiving app's share sheet → **Save to Files**.
3. Open **OTP Relay** on the iPhone.
4. Confirm that **HTTPS relay URL** is `https://otp-relay-production-a3b3.up.railway.app`.
5. Tap **Import private pairing file** and select `iphone.json`. Importing automatically saves the pairing to the shared Keychain and saves the server URL.
6. Check for **“Saved. Enable OTP Relay in iOS AutoFill settings.”** If you edit the URL afterward, tap **Save settings**.
7. Delete the temporary transferred JSON file from the phone after successful import, including its copy in Files → Recently Deleted if applicable. Keep your original Mac pairing files securely for recovery.

Do not import `android.json`, `server.env` or `metrics.json` into the iPhone. Use the existing pairing that matches the deployed service; running provisioning again changes credentials and requires coordinated server/device updates. A fresh repository clone does not include these private files.

## 6. Enable the AutoFill provider

1. On your iPhone, open **Settings → General → AutoFill & Passwords**. If labels differ on your iOS version, search Settings for **AutoFill**.
2. Enable **AutoFill Passwords and Passkeys** if needed.
3. Enable **OTP Relay / OTP Relay Codes** in the available provider list.

Apple documents the [AutoFill settings location](https://support.apple.com/guide/iphone/automatically-fill-in-strong-passwords-iphf9219d8c9/ios) and the supported [one-time-code credential provider interface](https://developer.apple.com/documentation/authenticationservices/providing-one-time-passcodes-to-autofill).

## 7. Test before using a real SMS

On your Mac, open Terminal in the repository root and run with Node.js 22 or later:

```bash
cd /Users/mac/Desktop/otp-relay-starter
node scripts/upload-synthetic.mjs
```

This uploads an encrypted synthetic test code using the existing local Android pairing. It prints only the upload status, never the code or credentials.

1. Within **90 seconds**, tap **Fetch latest OTP** in the iPhone app. A successful fetch confirms the phone can authenticate and decrypt the exact code, including mixed case and leading zeros.
2. To test AutoFill, focus a compatible verification-code field in Safari or an app (web fields use `autocomplete="one-time-code"`; native fields use `.oneTimeCode`). Open the system AutoFill/verification-code chooser, choose **OTP Relay**, then tap **Fill …** in its extension.
3. Only select the code for the service you intended. The extension currently offers the latest pending code and does not match it to a particular website.

The synthetic value is not a valid login code for a real service. Use a test field for the AutoFill check. iOS controls the chooser and inline suggestions, so a keyboard suggestion is not guaranteed in every field. Fetching in the main app does not consume a code; **Mark this code used** does, so leave that button alone until you finish the AutoFill test. Upload another synthetic code whenever one expires or is consumed.

For actual SMS delivery, follow the [Android setup](../docs/mobile-setup.md#android): install its APK, import its own `android.json`, approve the exact sender IDs, grant SMS permission and explicitly enable forwarding. Forwarding remains off until those steps are completed. Easypaisa-style mixed-case alphanumeric OTPs retain their original string throughout the relay and iOS AutoFill.

**Listen while app is open** keeps the main app waiting for fresh codes only while it is active. The AutoFill extension fetches when opened. Background push delivery is not implemented; the iPhone needs internet access, and pending codes expire after at most 90 seconds.

## Troubleshooting

| Problem | What to check |
|---|---|
| “Signing requires a development team” | Select your own team for both OTPRelay and OTPProvider. |
| Personal Team does not support a capability | Use your own developer membership that supports all required entitlements. Removing App Groups/AutoFill breaks the full setup. |
| Bundle identifier or App Group unavailable | Choose identifiers available to your own account, then update both targets and the shared group setting. |
| Provisioning profile lacks an entitlement | Check all three capabilities and let Xcode refresh profiles for both targets. |
| Device is unavailable in Xcode | Unlock it, trust/pair it, enable Developer Mode, and check that Xcode supports its installed iOS version. |
| “Unable to save pairing” or Keychain error | Check that you chose `iphone.json`, both targets share the same Keychain access group/profile prefix, and no `LOCAL.` device override remains. |
| Provider missing from AutoFill settings | Confirm iOS 18+, successful installation of the app with its embedded extension, and AutoFill entitlements. Open the app once, then revisit Settings. |
| App fetch works but extension cannot fetch | Recheck the shared App Group, shared Keychain group, and matching signing team on both targets. |
| No active code | Upload a fresh test, fetch within 90 seconds, and check internet access and automatic date/time on both phones. A consumed code will be gone. |
| Authentication or decryption fails | Use the existing matching private pairing files and correct HTTPS URL; do not regenerate only one device's credentials. |
| App later stops launching | Check signing/profile validity and rebuild with ⌘R. Free Personal Team profiles expire after seven days, per Apple's account documentation above. |

To update the app, reopen the same project with the same identifiers/team, connect your phone and press **⌘R** again. Keep your private pairing backup; signing or identifier changes may require importing it again.
