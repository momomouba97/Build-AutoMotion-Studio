#!/usr/bin/env node
'use strict';
// Copies the FFmpeg / FFprobe executables for the TARGET platform/arch into resources/bin (bundled inside the app).
// Override with FFMPEG_BIN / FFPROBE_BIN to use custom builds (e.g. from scripts/build_ffmpeg.sh).
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const platform = process.env.TARGET_PLATFORM || process.platform;
const arch = process.env.TARGET_ARCH || process.arch;
const exe = platform === 'win32' ? '.exe' : '';
const outDir = path.join(root, 'resources', 'bin');
fs.mkdirSync(outDir, { recursive: true });

function pick(envName, candidates, label) {
  const list = [process.env[envName], ...candidates].filter(Boolean);
  for (const c of list) if (fs.existsSync(c) && fs.statSync(c).size > 100000) return c;
  console.error(`ERROR: ${label} binary not found for ${platform}/${arch}. Looked in:\n  ` + list.join('\n  '));
  process.exit(1);
}

const ffmpegSrc = pick('FFMPEG_BIN', [path.join(root, 'node_modules', 'ffmpeg-static', 'ffmpeg' + exe)], 'ffmpeg');
const ffprobeSrc = pick('FFPROBE_BIN', [path.join(root, 'node_modules', 'ffprobe-static', 'bin', platform, arch, 'ffprobe' + exe)], 'ffprobe');

for (const [src, name] of [[ffmpegSrc, 'ffmpeg'], [ffprobeSrc, 'ffprobe']]) {
  const dst = path.join(outDir, name + exe);
  try { fs.rmSync(dst, { force: true }); } catch (_) { /* */ }
  fs.copyFileSync(src, dst);
  fs.chmodSync(dst, 0o755);
  console.log(`bundled ${name}: ${src} -> ${dst} (${(fs.statSync(dst).size / 1048576).toFixed(1)} MB)`);
}
