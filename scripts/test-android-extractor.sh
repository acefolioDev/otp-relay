#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")/.."
TASK_TEST_DIR=$(mktemp -d)
trap 'rm -rf "$TASK_TEST_DIR"' EXIT
"${KOTLINC:-kotlinc}" android/app/src/main/java/com/example/otprelay/OtpExtractor.kt android/app/src/main/java/com/example/otprelay/RelayCipher.kt android/tests/*.kt -include-runtime -d "$TASK_TEST_DIR/extractor-tests.jar"
java -jar "$TASK_TEST_DIR/extractor-tests.jar"
