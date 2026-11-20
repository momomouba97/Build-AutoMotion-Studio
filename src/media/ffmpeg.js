'use strict';
// Thin wrappers around ffmpeg / ffprobe (child processes, no shell).
const { spawn } = require('child_process');
const paths = require('../main/paths');

const live = new Set();

function killAll() {
  for (const c of live) { try { c.kill('SIGKILL'); } catch (_) { /* ignore */ } }
  live.clear();
}

// Runs a binary, resolves {code, stdout(Buffer), stderr(string)}.
function run(bin, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    live.add(child);
    const out = [];
    let err = '';
    let killedBySignal = false;
    if (opts.signal) {
      const onAbort = () => { killedBySignal = true; try { child.kill('SIGKILL'); } catch (_) { /* */ } };
      if (opts.signal.aborted) onAbort(); else opts.signal.addEventListener('abort', onAbort, { once: true });
    }
    child.stdout.on('data', (d) => {
      if (opts.onStdout) opts.onStdout(d); else out.push(d);
    });
    child.stderr.on('data', (d) => {
      err += d.toString();
      if (err.length > 20000) err = err.slice(-10000);
      if (opts.onStderr) opts.onStderr(d.toString());
    });
    child.on('error', (e) => { live.delete(child); reject(e); });
    child.on('close', (code) => {
      live.delete(child);
      if (killedBySignal) { const e = new Error('cancelled'); e.cancelled = true; return reject(e); }
      resolve({ code, stdout: Buffer.concat(out), stderr: err });
    });
  });
}

const ffmpeg = (args, opts) => run(paths.ffmpegPath(), args, opts);
const ffprobeRun = (args, opts) => run(paths.ffprobePath(), args, opts);

function parseRate(r) {
  if (!r) return 0;
  const [a, b] = String(r).split('/').map(Number);
  if (!b) return a || 0;
  return a / b;
}

async function probe(file) {
  const r = await ffprobeRun(['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file]);
  if (r.code !== 0) throw new Error('ffprobe failed: ' + r.stderr.split('\n').slice(-3).join(' '));
  const j = JSON.parse(r.stdout.toString() || '{}');
  const v = (j.streams || []).find((s) => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic));
  const a = (j.streams || []).find((s) => s.codec_type === 'audio');
  let width = v ? v.width : 0;
  let height = v ? v.height : 0;
  if (v) {
    let rot = 0;
    if (v.tags && v.tags.rotate) rot = parseInt(v.tags.rotate, 10) || 0;
    for (const sd of v.side_data_list || []) if (sd.rotation !== undefined) rot = Math.round(sd.rotation);
    if (Math.abs(rot) % 180 === 90) { const t = width; width = height; height = t; }
  }
  const duration = parseFloat((j.format && j.format.duration) || (v && v.duration) || (a && a.duration) || 0) || 0;
  return {
    duration,
    hasVideo: !!v,
    hasAudio: !!a,
    width,
    height,
    fps: v ? (parseRate(v.avg_frame_rate) || parseRate(v.r_frame_rate)) : 0,
    codec: v ? v.codec_name : (a ? a.codec_name : ''),
    bitrate: parseInt((j.format && j.format.bit_rate) || 0, 10) || 0,
  };
}

// Decode any media's audio to mono Float32 PCM.
async function decodeAudio(file, sampleRate) {
  const chunks = [];
  const r = await ffmpeg(['-v', 'error', '-nostdin', '-i', file, '-vn', '-ac', '1', '-ar', String(sampleRate), '-f', 'f32le', 'pipe:1'],
    { onStdout: (d) => chunks.push(d) });
  if (r.code !== 0) throw new Error('audio decode failed: ' + r.stderr.split('\n').slice(-3).join(' '));
  const buf = Buffer.concat(chunks);
  const ab = new ArrayBuffer(buf.length - (buf.length % 4));
  Buffer.from(ab).set(buf.subarray(0, ab.byteLength));
  return new Float32Array(ab);
}

let encoderCache = null;
// Detects which encoders really work on this machine (VideoToolbox is test-encoded).
async function detectEncoders(force) {
  if (encoderCache && !force) return encoderCache;
  const res = { libx264: false, libx265: false, h264_videotoolbox: false, hevc_videotoolbox: false, aac: false, version: '' };
  try {
    const v = await ffmpeg(['-hide_banner', '-version']);
    res.version = v.stdout.toString().split('\n')[0];
    const e = await ffmpeg(['-hide_banner', '-encoders']);
    const txt = e.stdout.toString();
    for (const k of Object.keys(res)) if (typeof res[k] === 'boolean') res[k] = new RegExp('\\s' + k + '\\s').test(txt);
    for (const k of ['h264_videotoolbox', 'hevc_videotoolbox']) {
      if (!res[k]) continue;
      const t = await ffmpeg(['-hide_banner', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=30:d=0.4', '-frames:v', '6',
        '-c:v', k, '-b:v', '4M', '-pix_fmt', 'yuv420p', '-f', 'null', '-']);
      res[k] = t.code === 0;
    }
  } catch (e) { res.error = String(e.message || e); }
  encoderCache = res;
  return res;
}

module.exports = { run, ffmpeg, ffprobeRun, probe, decodeAudio, detectEncoders, killAll };
