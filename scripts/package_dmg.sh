#!/usr/bin/env bash
# Creates dist/AutoMotion-Studio-Intel.dmg containing the app and an Applications shortcut.
set -euo pipefail
cd "$(dirname "$0")/.."
APP="$(find dist -maxdepth 2 -name 'AutoMotion Studio.app' -type d | sed -n 1p)"
[[ -n "$APP" ]] || { echo "::error::No .app found in dist/. Run scripts/build_macos.sh first."; exit 1; }
OUT="dist/AutoMotion-Studio-Intel.dmg"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

ditto "$APP" "$STAGE/AutoMotion Studio.app"
ln -s /Applications "$STAGE/Applications"
cat > "$STAGE/READ ME FIRST.txt" <<'TXT'
AutoMotion Studio (Intel, macOS 11+)
1. Drag "AutoMotion Studio" into Applications.
2. First launch: right-click the app > Open > Open (the app is not notarized).
   If macOS says the app is damaged, run in Terminal:  xattr -cr "/Applications/AutoMotion Studio.app"
3. Everything runs offline; FFmpeg is bundled.
TXT

rm -f "$OUT"
hdiutil create -volname "AutoMotion Studio" -srcfolder "$STAGE" -fs HFS+ -format UDZO -ov "$OUT"
ls -lh "$OUT"
echo "DMG created: $OUT"
