#!/usr/bin/env bash
# OPTIONAL: builds FFmpeg 6.1.1 (+ x264, VideoToolbox) from source with MACOSX_DEPLOYMENT_TARGET=11.0 on an Intel Mac runner.
# Used when the workflow input "ffmpeg_source" = build. Produces resources/bin/ffmpeg and resources/bin/ffprobe.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$PWD"
if [[ "$(uname -m)" != "x86_64" ]]; then echo "::error::build_ffmpeg.sh needs an Intel (x86_64) runner (use runner macos-15-intel)."; exit 1; fi
export MACOSX_DEPLOYMENT_TARGET=11.0
WORK="$ROOT/.tmp/ffbuild"; PREFIX="$WORK/prefix"
mkdir -p "$WORK" "$PREFIX" "$ROOT/resources/bin"
cd "$WORK"
brew install nasm pkg-config || true

echo "::group::x264"
rm -rf x264 && git clone --depth 1 --branch stable https://code.videolan.org/videolan/x264.git
( cd x264 && ./configure --prefix="$PREFIX" --enable-static --disable-cli --disable-opencl \
    --extra-cflags="-mmacosx-version-min=11.0" --extra-ldflags="-mmacosx-version-min=11.0" \
  && make -j"$(sysctl -n hw.ncpu)" && make install )
echo "::endgroup::"

echo "::group::ffmpeg"
FFV=6.1.1
curl -fsSL "https://ffmpeg.org/releases/ffmpeg-${FFV}.tar.xz" -o ffmpeg.tar.xz
rm -rf "ffmpeg-${FFV}" && tar xf ffmpeg.tar.xz
cd "ffmpeg-${FFV}"
PKG_CONFIG_PATH="$PREFIX/lib/pkgconfig" ./configure \
  --prefix="$PREFIX/out" --arch=x86_64 --cc="clang -arch x86_64" \
  --enable-gpl --enable-libx264 --enable-videotoolbox --enable-audiotoolbox \
  --disable-ffplay --disable-doc --disable-debug --enable-static --disable-shared \
  --pkg-config-flags=--static \
  --extra-cflags="-I$PREFIX/include -mmacosx-version-min=11.0" --extra-ldflags="-L$PREFIX/lib -mmacosx-version-min=11.0"
make -j"$(sysctl -n hw.ncpu)"
cp ffmpeg ffprobe "$ROOT/resources/bin/"
chmod +x "$ROOT/resources/bin/ffmpeg" "$ROOT/resources/bin/ffprobe"
echo "::endgroup::"
file "$ROOT/resources/bin/ffmpeg"
