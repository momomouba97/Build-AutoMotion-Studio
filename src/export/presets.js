'use strict';
// Turns UI export choices + detected encoders into concrete render settings.
const os = require('os');

function even(n) { return Math.max(2, Math.round(n / 2) * 2); }

function outputSize(aspect, res, presets) {
  const h0 = presets.resolutions[String(res)] || 1080;
  const [aw, ah] = presets.aspects[aspect] || [16, 9];
  if (aw === ah) return { width: even(h0), height: even(h0) };
  if (aw > ah) return { width: even((h0 * aw) / ah), height: even(h0) };
  return { width: even(h0), height: even((h0 * ah) / aw) };
}

function resolveSettings(ui, presets, encoders) {
  const mode = presets.modes[ui.mode] ? ui.mode : 'balanced';
  const m = presets.modes[mode];
  const { width, height } = outputSize(ui.aspect || '16:9', ui.res || 1080, presets);
  const fps = [24, 25, 30, 60].includes(Number(ui.fps)) ? Number(ui.fps) : 30;
  const warnings = [];
  let codec = ui.codec === 'h265' ? 'h265' : 'h264';
  const hwWanted = ui.hw !== 'off';
  const hw = codec === 'h265' ? encoders.hevc_videotoolbox : encoders.h264_videotoolbox;
  const sw = codec === 'h265' ? encoders.libx265 : encoders.libx264;
  let encoder;
  if (hwWanted && hw && (mode !== 'max' || !sw)) encoder = codec === 'h265' ? 'hevc_videotoolbox' : 'h264_videotoolbox';
  else if (sw) encoder = codec === 'h265' ? 'libx265' : 'libx264';
  else if (hw) encoder = codec === 'h265' ? 'hevc_videotoolbox' : 'h264_videotoolbox';
  else if (codec === 'h265' && encoders.libx264) { codec = 'h264'; encoder = 'libx264'; warnings.push('H.265 encoder not available; using H.264.'); }
  else if (codec === 'h265' && encoders.h264_videotoolbox) { codec = 'h264'; encoder = 'h264_videotoolbox'; warnings.push('H.265 encoder not available; using H.264.'); }
  else throw new Error('No usable video encoder found in the bundled FFmpeg.');
  if (!encoders.aac) throw new Error('AAC encoder missing in the bundled FFmpeg.');
  const cpus = Math.max(1, os.cpus().length);
  const isHW = /videotoolbox/.test(encoder);
  const threadsPer = isHW ? 1 : Math.min(4, Math.max(1, Math.floor(cpus / 2)));
  const concurrency = isHW ? Math.min(3, cpus) : Math.max(1, Math.min(4, Math.floor(cpus / threadsPer)));
  const bitrate = Math.round(width * height * fps * m.vtBitsPerPixel);
  return {
    mode, codec, encoder, isHW, width, height, fps,
    container: ui.container === 'mov' ? 'mov' : 'mp4',
    x264: m.x264, x265: m.x265, bitrate, scaleFlags: m.scaleFlags, audioBitrate: m.audioBitrate,
    fadeOut: ui.fadeOut === undefined ? 1 : Number(ui.fadeOut),
    threadsPer, concurrency, warnings,
  };
}

module.exports = { outputSize, resolveSettings };
