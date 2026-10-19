#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/.."
TASK_TEST_DIR=$(mktemp -d)
trap 'rm -rf "$TASK_TEST_DIR"' EXIT
swiftc ios/Shared/RelayPayload.swift ios/tests/RelayPayloadTests.swift -o "$TASK_TEST_DIR/payload-tests"
"$TASK_TEST_DIR/payload-tests"
