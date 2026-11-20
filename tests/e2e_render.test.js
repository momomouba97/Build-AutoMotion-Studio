'use strict';
// End-to-end: synthetic footage + music -> scan -> analyse -> auto edit -> render -> verify output with ffprobe.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const paths = require('../src/main/paths');
const { Cache } = require('../src/cache/cache');
const { Scanner } = require('../src/media/scanner');
const ff = require('../src/media/ffmpeg');
const { AudioService } = require('../src/audio/audio_service');
const AE = require('../src/timeline/autoedit');
const TL = require('../src/timeline/model');
const { resolveSettings } = require('../src/export/presets');
const { renderProject } = require('../src/rendering/renderer');
const { synthTrack, writeWav } = require('./helpers/synth');

const probeOk = spawnSync(paths.ffmpegPath(), ['-version']).status === 0;

test('full pipeline renders a beat-synced video', { skip: !probeOk && 'ffmpeg not runnable here', timeout: 240000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ams-e2e-'));
  const cfg = paths.loadConfig(), presets = paths.loadPresets();
  const mk = (dir, name, src, secs) => {
    fs.mkdirSync(path.join(tmp, dir), { recursive: true });
    const r = spawnSync(paths.ffmpegPath(), ['-v', 'error', '-y', '-f', 'lavfi', '-i', `${src}=size=640x360:rate=25`, '-t', String(secs),
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', path.join(tmp, dir, name)]);
    assert.strictEqual(r.status, 0, String(r.stderr));
  };
  mk('moving', 'a.mp4', 'testsrc2', 12); mk('moving', 'b.mp4', 'mandelbrot', 12); mk('moving', 'c.mp4', 'smptebars', 10);
  mk('parked', 'p1.mp4', 'testsrc', 10); mk('parked', 'p2.mp4', 'rgbtestsrc', 10);
  const { samples, sr } = synthTrack({ bpm: 120, seconds: 24, offset: 0.1, breakdown: [10, 16] });
  fs.mkdirSync(path.join(tmp, 'music'));
  writeWav(path.join(tmp, 'music', 'song.wav'), samples, sr);

  const cache = new Cache(path.join(tmp, 'cache'));
  const scanner = new Scanner(cache, cfg);
  const moving = await scanner.scan([path.join(tmp, 'moving')], 'moving');
  const parked = await scanner.scan([path.join(tmp, 'parked')], 'parked');
  const music = await scanner.scan([path.join(tmp, 'music')], 'music');
  assert.strictEqual(moving.length, 3); assert.strictEqual(parked.length, 2); assert.strictEqual(music.length, 1);
  assert.ok(Math.abs(music[0].duration - 24) < 0.1);

  const audio = new AudioService(cache, cfg);
  const first = await audio.analyze(music[0].path);
  assert.strictEqual(first.fromCache, false);
  assert.ok(Math.abs(first.analysis.bpm - 120) < 1.5);
  const t1 = Date.now();
  const second = await audio.analyze(music[0].path);
  assert.strictEqual(second.fromCache, true, 'analysis must be cached');
  assert.ok(Date.now() - t1 < 500);

  const pools = { moving: moving.map((m) => ({ ...m })), parked: parked.map((m) => ({ ...m })) };
  const tl = TL.create(30);
  const { clips } = AE.generate({ analysis: first.analysis, pools, options: { seed: 3, cutMode: 'auto', fps: 30 } });
  tl.clips = clips;
  TL.addClip(tl, { kind: 'audio', track: 'A1', src: music[0].path, mediaId: music[0].id, srcIn: 0, start: 0, dur: first.analysis.duration, srcDur: first.analysis.duration });
  assert.deepStrictEqual(TL.validate(tl), []);

  const enc = await ff.detectEncoders();
  assert.ok(enc.libx264 && enc.aac);
  const settings = resolveSettings({ mode: 'fast', res: 720, fps: 30, aspect: '16:9', container: 'mp4', codec: 'h264', hw: 'off' }, presets, enc);
  const out = path.join(tmp, 'out.mp4');
  const events = [];
  const res = await renderProject({ timeline: tl, settings, outPath: out, cache, totalDur: first.analysis.duration, onProgress: (e) => events.push(e) });
  assert.ok(fs.existsSync(out) && res.size > 10000);
  assert.ok(events.some((e) => e.phase === 'mux') && events[events.length - 1].pct === 1);

  const p = await ff.probe(out);
  assert.strictEqual(p.width, 1280); assert.strictEqual(p.height, 720);
  assert.ok(Math.abs(p.duration - 24) < 0.1, 'duration ' + p.duration);
  assert.ok(p.hasAudio && Math.abs(p.fps - 30) < 0.01);
  console.log('first render', res.seconds.toFixed(1) + 's', 'segments', res.segments);

  // Smart regenerate: only the changed clip is re-encoded
  const swapped = AE.regenerateClip(tl.clips.filter((c) => c.kind === 'video'), clips[2].id, pools, { seed: 99, fps: 30 });
  Object.assign(tl.clips.find((c) => c.id === clips[2].id), swapped);
  const res2 = await renderProject({ timeline: tl, settings, outPath: path.join(tmp, 'out2.mp4'), cache, totalDur: first.analysis.duration });
  assert.ok(res2.encoded <= 3, 're-encoded only ' + res2.encoded + ' of ' + res2.segments);
  console.log('after regenerate: encoded', res2.encoded, 'cached', res2.cached, res2.seconds.toFixed(1) + 's');

  // 9:16 + H.265 + MOV + crop
  const vclip = tl.clips.find((c) => c.kind === 'video'); TL.setCrop(tl, vclip.id, { x: 0.1, y: 0.1, w: 0.6, h: 0.6 });
  const s2 = resolveSettings({ mode: 'balanced', res: 720, fps: 24, aspect: '9:16', container: 'mov', codec: 'h265', hw: 'off' }, presets, enc);
  const res3 = await renderProject({ timeline: tl, settings: s2, outPath: path.join(tmp, 'out3.mov'), cache, totalDur: 8 });
  const p3 = await ff.probe(res3.outPath);
  assert.strictEqual(p3.width, 720); assert.strictEqual(p3.height, 1280); assert.strictEqual(p3.codec, 'hevc');

  // cancellation
  const ac = new AbortController();
  const pr = renderProject({ timeline: tl, settings: { ...settings, width: 1920, height: 1080, mode: 'max', x264: { preset: 'slow', crf: 18 } }, outPath: path.join(tmp, 'c.mp4'), cache, totalDur: 24, signal: ac.signal });
  setTimeout(() => ac.abort(), 300);
  await assert.rejects(pr, /cancel/i);
  fs.rmSync(tmp, { recursive: true, force: true });
});
