#!/usr/bin/env bash
# Installs all build dependencies (Electron, electron-builder, bundled FFmpeg/FFprobe binaries) for macOS Intel (x86_64).
set -euo pipefail
cd "$(dirname "$0")/.."

echo "Node $(node -v) / npm $(npm -v) / $(uname -sm)"
if [[ "$(uname -s)" == "Darwin" ]]; then
  # Force x86_64 payloads even if the build machine is Apple Silicon (cross build).
  export npm_config_arch="${TARGET_ARCH:-x64}"
  export npm_config_platform=darwin
  echo "Target: darwin/${npm_config_arch}"
fi

if [[ -f package-lock.json ]]; then
  npm ci --no-audit --no-fund || { echo "npm ci failed, falling back to npm install"; npm install --no-audit --no-fund; }
else
  npm install --no-audit --no-fund
fi
echo "Dependencies installed."
