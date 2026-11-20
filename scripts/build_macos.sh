#!/usr/bin/env bash
# Builds AutoMotion Studio.app for macOS Intel (x86_64), deployment target macOS 11.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${APP_VERSION:=1.0.0}"
export CSC_IDENTITY_AUTO_DISCOVERY=false
export MACOSX_DEPLOYMENT_TARGET=11.0

echo "::group::Check bundled binaries"
for b in ffmpeg ffprobe; do
  [[ -x "resources/bin/$b" ]] || { echo "::error::resources/bin/$b is missing. Run: node scripts/prepare_binaries.js"; exit 1; }
  ls -lh "resources/bin/$b"
done
echo "::endgroup::"

echo "::group::electron-builder (x64, version ${APP_VERSION})"
rm -rf dist
npx --no-install electron-builder --mac --x64 --dir --publish never \
  -c.extraMetadata.version="${APP_VERSION}" -c.mac.identity=null
echo "::endgroup::"

APP="$(find dist -maxdepth 2 -name 'AutoMotion Studio.app' -type d | sed -n 1p)"
[[ -n "$APP" && -d "$APP" ]] || { echo "::error::AutoMotion Studio.app was not produced by electron-builder."; ls -R dist | head -50; exit 1; }
echo "App bundle: $APP"

echo "::group::Ad-hoc code signature (no developer account needed)"
xattr -cr "$APP" || true
codesign --force --deep --sign - "$APP"
codesign --verify --deep --verbose=2 "$APP"
echo "::endgroup::"
echo "$APP" > dist/.app_path
echo "Build OK."
