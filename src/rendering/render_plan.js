'use strict';
// Builds the FFmpeg argument lists for segment encodes and the final concat + audio mix.
const { hash } = require('../cache/cache');

const num = (x) => (Math.round(x * 1e6) / 1e6).toString();

function encoderArgs(s) {
  switch (s.encoder) {
    case 'libx264':
      return ['-c:v', 'libx264', '-preset', s.x264.preset, '-crf', String(s.x264.crf), '-threads', String(s.threadsPer), '-profile:v', 'high'];
    case 'libx265':
      return ['-c:v', 'libx265', '-preset', s.x265.preset, '-crf', String(s.x265.crf), '-tag:v', 'hvc1',
        '-x265-params', `log-level=error:pools=${s.threadsPer}:frame-threads=1`];
    case 'h264_videotoolbox':
      return ['-c:v', 'h264_videotoolbox', '-b:v', String(s.bitrate), '-profile:v', 'high', '-allow_sw', '1'];
    case 'hevc_videotoolbox':
      return ['-c:v', 'hevc_videotoolbox', '-b:v', String(s.bitrate), '-tag:v', 'hvc1', '-allow_sw', '1'];
    default: throw new Error('Unknown encoder ' + s.encoder);
  }
}

function videoFilter(seg, s) {
  const f = [];
  if (seg.speed && seg.speed !== 1) f.push(`setpts=(PTS-STARTPTS)/${num(seg.speed)}`);
  f.push(`fps=${s.fps}`);
  if (seg.crop) {
    const c = seg.crop;
    f.push(`crop=trunc(iw*${num(c.w)}/2)*2:trunc(ih*${num(c.h)}/2)*2:trunc(iw*${num(c.x)}/2)*2:trunc(ih*${num(c.y)}/2)*2`);
  }
  f.push(`scale=${s.width}:${s.height}:force_original_aspect_ratio=increase:flags=${s.scaleFlags}`);
  f.push(`crop=${s.width}:${s.height}`);
  f.push('setsar=1');
  f.push('tpad=stop_mode=clone:stop_duration=3'); // never run short: clone the last frame
  f.push('format=yuv420p');
  return f.join(',');
}

// Identical settings => identical key => segment re-used from cache (no re-encode of unchanged clips).
function segmentKey(seg, s, srcSig) {
  return hash('seg-v1', seg.black ? 'black' : srcSig, num(seg.srcIn || 0), seg.frames, num(seg.speed || 1),
    JSON.stringify(seg.crop || null), s.width, s.height, s.fps, s.encoder, s.mode, s.bitrate,
    JSON.stringify(s.x264), JSON.stringify(s.x265), s.scaleFlags);
}

function segmentArgs(seg, s, out) {
  const common = ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error'];
  const tail = ['-frames:v', String(seg.frames), ...encoderArgs(s), '-pix_fmt', 'yuv420p', '-an', '-sn', '-dn',
    '-video_track_timescale', '90000', '-f', 'mp4', out];
  if (seg.black) {
    return [...common, '-f', 'lavfi', '-i', `color=c=black:s=${s.width}x${s.height}:r=${s.fps}`, ...tail];
  }
  return [...common, '-ss', num(seg.srcIn), '-i', seg.src, '-vf', videoFilter(seg, s), ...tail];
}

function concatListText(files) {
  const esc = (p) => p.replace(/'/g, "'\\''");
  return files.map((f) => `file '${esc(f.path)}'\nduration ${num(f.duration)}`).join('\n') + '\n';
}

// audioClips: [{src, srcIn, start, dur, gain}]
function finalArgs({ listPath, audioClips, settings: s, totalDur, outPath }) {
  const args = ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', '-progress', 'pipe:1', '-nostats',
    '-f', 'concat', '-safe', '0', '-i', listPath];
  const clips = audioClips.filter((c) => c.start < totalDur - 0.01);
  clips.forEach((c) => {
    const d = Math.min(c.dur, totalDur - c.start);
    args.push('-ss', num(c.srcIn || 0), '-t', num(d), '-i', c.src);
  });
  args.push('-map', '0:v:0');
  if (clips.length) {
    const parts = [];
    clips.forEach((c, i) => {
      const ms = Math.round(c.start * 1000);
      parts.push(`[${i + 1}:a]aresample=48000,aformat=channel_layouts=stereo,asetpts=PTS-STARTPTS,volume=${num(c.gain === undefined ? 1 : c.gain)},adelay=${ms}:all=1[a${i}]`);
    });
    const labels = clips.map((_, i) => `[a${i}]`).join('');
    const fade = Math.max(0, Math.min(s.fadeOut || 0, totalDur / 2));
    let chain = clips.length > 1 ? `${labels}amix=inputs=${clips.length}:duration=longest:dropout_transition=0:normalize=0` : `${labels}anull`;
    chain += `,atrim=duration=${num(totalDur)}`;
    if (fade > 0) chain += `,afade=t=out:st=${num(totalDur - fade)}:d=${num(fade)}`;
    chain += ',alimiter=limit=0.97[aout]';
    parts.push(chain);
    args.push('-filter_complex', parts.join(';'), '-map', '[aout]', '-c:a', 'aac', '-b:a', s.audioBitrate, '-ar', '48000');
  } else args.push('-an');
  args.push('-c:v', 'copy', '-t', num(totalDur), '-movflags', '+faststart');
  if (s.codec === 'h265') args.push('-tag:v', 'hvc1');
  args.push(outPath);
  return args;
}

module.exports = { encoderArgs, videoFilter, segmentKey, segmentArgs, concatListText, finalArgs, num };
