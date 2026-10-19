#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/.."
TASK_TEST_DIR=$(mktemp -d)
trap 'rm -rf "$TASK_TEST_DIR"' EXIT
swiftc ios/Shared/RelayPayload.swift ios/tests/LiveRelaySmoke.swift -o "$TASK_TEST_DIR/live-tests"
# Upload only a synthetic code; private token/key stay in local files and encrypted HTTPS requests.
node --input-type=module <<'JS'
import { readFile } from 'node:fs/promises';
import { encryptedUpload } from './scripts/encrypt-example.mjs';
const p=JSON.parse(await readFile('provisioning/android.json','utf8'));
const base=process.env.RELAY_BASE_URL ?? 'https://otp-relay-production-a3b3.up.railway.app';
const r=await fetch(base+'/api/v1/otp',{method:'POST',redirect:'error',headers:{authorization:`Bearer ${p.token}`,'content-type':'application/json'},body:JSON.stringify(encryptedUpload(p)),signal:AbortSignal.timeout(10000)});
if(r.status!==201)throw new Error('Synthetic upload failed');
JS
"$TASK_TEST_DIR/live-tests"
