#!/usr/bin/env bash
# Verifies the DMG really exists, contains the app, targets Intel x86_64 and macOS <= 11.7.11, and bundles FFmpeg.
set -euo pipefail
cd "$(dirname "$0")/.."
DMG="dist/AutoMotion-Studio-Intel.dmg"
MAXOS="11.7.11"
fail() { echo "::error::$*"; exit 1; }
[[ -s "$DMG" ]] || fail "DMG not found or empty: $DMG"
hdiutil verify "$DMG" >/dev/null || fail "hdiutil verify failed"

MNT="$(mktemp -d)"
cleanup() { hdiutil detach "$MNT" -quiet -force >/dev/null 2>&1 || true; }
trap cleanup EXIT
hdiutil attach "$DMG" -nobrowse -readonly -mountpoint "$MNT" -quiet || fail "cannot mount DMG"

APP="$MNT/AutoMotion Studio.app"
[[ -d "$APP" ]] || fail "AutoMotion Studio.app is not inside the DMG"
[[ -L "$MNT/Applications" ]] || fail "Applications shortcut missing in DMG"
echo "OK  app + Applications shortcut present in DMG"

le_version() { [[ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | sed -n 1p)" == "$1" ]]; }  # $1 <= $2

minos() {  # prints minimum macOS version of a Mach-O (first slice)
  otool -l "$1" 2>/dev/null | awk '
    /LC_BUILD_VERSION/ {b=1}
    b && $1=="minos" {print $2; exit}
    /LC_VERSION_MIN_MACOSX/ {m=1}
    m && $1=="version" {print $2; exit}' || true
}

PLIST="$APP/Contents/Info.plist"
LSMIN="$(/usr/libexec/PlistBuddy -c 'Print :LSMinimumSystemVersion' "$PLIST")"
le_version "$LSMIN" "$MAXOS" || fail "LSMinimumSystemVersion=$LSMIN is higher than $MAXOS"
echo "OK  Info.plist LSMinimumSystemVersion=$LSMIN (target: macOS $MAXOS)"
/usr/libexec/PlistBuddy -c 'Print :CFBundleName' "$PLIST"
/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$PLIST"

check_bin() {
  local f="$1" label="$2"
  [[ -f "$f" ]] || fail "$label missing: $f"
  local archs; archs="$(lipo -archs "$f" 2>/dev/null || true)"
  [[ "$archs" == "x86_64" ]] || fail "$label architectures are '$archs' (expected exactly x86_64)"
  local mo; mo="$(minos "$f")"
  [[ -n "$mo" ]] || fail "cannot read minimum macOS version of $label"
  le_version "$mo" "$MAXOS" || fail "$label requires macOS $mo, newer than $MAXOS. Re-run the workflow with ffmpeg_source=build."
  echo "OK  $label: x86_64, minos $mo"
}

check_bin "$APP/Contents/MacOS/AutoMotion Studio" "main executable"
FW="$(find "$APP/Contents/Frameworks/Electron Framework.framework/Versions" -name 'Electron Framework' -type f | sed -n 1p)"
check_bin "$FW" "Electron Framework"
check_bin "$APP/Contents/Resources/bin/ffmpeg" "bundled ffmpeg"
check_bin "$APP/Contents/Resources/bin/ffprobe" "bundled ffprobe"

for f in src/main/main.js src/ui/index.html src/timeline/autoedit.js config/app_config.json resources/presets/export_presets.json assets/icons/icon.png; do
  [[ -f "$APP/Contents/Resources/app/$f" ]] || fail "app resource missing: $f"
done
echo "OK  application resources present"

if [[ "$(uname -m)" == "x86_64" ]]; then
  "$APP/Contents/Resources/bin/ffmpeg" -hide_banner -version | head -1
  ENC="$("$APP/Contents/Resources/bin/ffmpeg" -hide_banner -encoders 2>/dev/null)"
  grep -q ' aac ' <<<"$ENC" || fail "bundled ffmpeg has no AAC encoder"
  grep -qE 'libx264|h264_videotoolbox' <<<"$ENC" || fail "bundled ffmpeg has no H.264 encoder"
  echo "OK  ffmpeg runs and has AAC + H.264 encoders"

  # Launch the real app headlessly (non-fatal: some CI sessions have no GUI).
  TMPAPP="$(mktemp -d)"; ditto "$APP" "$TMPAPP/app.app"
  OUTJ="$TMPAPP/smoke.json"
  ( AMS_SMOKE_OUT="$OUTJ" AMS_CACHE_DIR="$TMPAPP/cache" "$TMPAPP/app.app/Contents/MacOS/AutoMotion Studio" --smoke-test >"$TMPAPP/app.log" 2>&1 & echo $! >"$TMPAPP/pid" )
  for _ in $(seq 1 45); do [[ -s "$OUTJ" ]] && break; sleep 1; done
  kill "$(cat "$TMPAPP/pid")" >/dev/null 2>&1 || true
  if [[ -s "$OUTJ" ]] && grep -q '"hasApp": true' "$OUTJ"; then echo "OK  app launched and UI self-test ran:"; head -c 600 "$OUTJ"; echo
  else echo "::warning::App launch smoke test could not complete on this runner (not fatal). Log:"; tail -20 "$TMPAPP/app.log" || true; fi
else
  echo "NOTE: runner is $(uname -m); skipping execution of x86_64 binaries (static checks passed)."
fi
echo "VERIFY PASSED: $DMG ($(du -h "$DMG" | cut -f1))"
