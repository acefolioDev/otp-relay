#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/.."
TASK_SIMULATOR_ID=${TEST_SIMULATOR_ID:-$(xcrun simctl list devices booted --json | node --input-type=module -e 'let s="";for await(const c of process.stdin)s+=c;const d=Object.values(JSON.parse(s).devices).flat().filter(x=>x.state==="Booted");if(d.length!==1)throw Error("Boot exactly one iOS Simulator or set TEST_SIMULATOR_ID");process.stdout.write(d[0].udid)')}
xcodebuild -project ios/OTPRelay.xcodeproj -scheme OTPRelay -configuration Debug \
  -destination "platform=iOS Simulator,id=$TASK_SIMULATOR_ID" -derivedDataPath ios/build \
  CODE_SIGN_IDENTITY=- CODE_SIGNING_REQUIRED=NO DEVELOPMENT_TEAM= AppIdentifierPrefix=LOCAL. build-for-testing
xcrun simctl install "$TASK_SIMULATOR_ID" ios/build/Build/Products/Debug-iphonesimulator/OTPRelay.app
TASK_APP_CONTAINER=$(xcrun simctl get_app_container "$TASK_SIMULATOR_ID" com.acefolio.otprelay data)
TASK_PRIVATE_IMPORT="$TASK_APP_CONTAINER/Documents/relay-private-test.json"
trap 'rm -f "$TASK_PRIVATE_IMPORT"' EXIT
# Private data enters only this local Simulator sandbox; no secrets in command arguments/output.
node --input-type=module - "$TASK_PRIVATE_IMPORT" <<'JS'
import {copyFile,chmod} from 'node:fs/promises';
await copyFile('provisioning/iphone.json',process.argv[2]);await chmod(process.argv[2],0o600);
JS
node scripts/upload-synthetic.mjs
xcodebuild -project ios/OTPRelay.xcodeproj -scheme OTPRelay -configuration Debug \
  -destination "platform=iOS Simulator,id=$TASK_SIMULATOR_ID" -derivedDataPath ios/build \
  CODE_SIGN_IDENTITY=- CODE_SIGNING_REQUIRED=NO DEVELOPMENT_TEAM= AppIdentifierPrefix=LOCAL. test-without-building
