'use strict';
// Segment-based renderer: each timeline cut is encoded once (cached, parallel), then joined losslessly with the audio mix.
const fs = require('fs');
const path = require('path');
const { hash, fileSignature } = require('../cache/cache');
const ff = require('../media/ffmpeg');
const TLC = require('../timeline/compile');
const plan = require('./render_plan');

async function renderProject({ timeline: tlIn, settings, outPath, cache, totalDur, onProgress, signal }) {
  const t0 = Date.now();
  const s = settings;
  const timeline = Object.assign({}, tlIn, { fps: s.fps }); // frames are counted at the output frame rate
  const report = (o) => { if (onProgress) onProgress(o); };
  const total = totalDur !== undefined ? totalDur : TLCDuration(timeline);
  if (!(total > 0)) throw new Error('Timeline is empty.');
  const segs = TLC.flatten(timeline, total);
  if (!segs.length) throw new Error('Nothing to render.');

  const sigCache = new Map();
  const sigOf = async (p) => { if (!sigCache.has(p)) sigCache.set(p, hash(await fileSignature(p))); return sigCache.get(p); };
  for (const g of segs) if (!g.black) { try { g.sig = await sigOf(g.src); } catch (_) { throw new Error('Source file missing: ' + g.src); } }

  const segDir = cache.dir('segments');
  const jobs = segs.map((g, i) => {
    const key = plan.segmentKey(g, s, g.sig);
    return { i, g, file: path.join(segDir, key + '.mp4'), cached: false };
  });
  for (const j of jobs) {
    try { const st = await fs.promises.stat(j.file); j.cached = st.size > 0; } catch (_) { j.cached = false; }
  }
  const pending = jobs.filter((j) => !j.cached);
  const cachedCount = jobs.length - pending.length;
  let done = 0;
  report({ phase: 'segments', pct: 0, done: 0, total: pending.length, cached: cachedCount, segments: jobs.length });

  const ctl = new AbortController();
  if (signal) { if (signal.aborted) ctl.abort(); else signal.addEventListener('abort', () => ctl.abort(), { once: true }); }
  let failure = null;
  let next = 0;
  const worker = async () => {
    while (!failure && !ctl.signal.aborted) {
      const j = pending[next++];
      if (!j) return;
      const tmp = j.file + '.' + process.pid + '.part';
      const r = await ff.ffmpeg(plan.segmentArgs(j.g, s, tmp), { signal: ctl.signal }).catch((e) => ({ code: -1, stderr: String(e.message), cancelled: e.cancelled }));
      if (r.code !== 0) {
        if (!r.cancelled && !failure) { failure = new Error(`Segment ${j.i + 1}/${jobs.length} failed (${j.g.black ? 'black' : path.basename(j.g.src)} @${j.g.start.toFixed(2)}s):\n${(r.stderr || '').trim().split('\n').slice(-6).join('\n')}`); ctl.abort(); }
        try { await fs.promises.unlink(tmp); } catch (_) { /* */ }
        return;
      }
      await fs.promises.rename(tmp, j.file);
      done++;
      report({ phase: 'segments', pct: (done / Math.max(1, pending.length)) * 0.88, done, total: pending.length, cached: cachedCount, segments: jobs.length });
    }
  };
  await Promise.all(Array.from({ length: Math.min(s.concurrency, Math.max(1, pending.length)) }, worker));
  if (failure) throw failure;
  if (ctl.signal.aborted) { const e = new Error('Export cancelled'); e.cancelled = true; throw e; }

  // Final join + audio
  const tmpDir = cache.dir('tmp');
  const listPath = path.join(tmpDir, 'list-' + hash(outPath, Date.now()).slice(0, 10) + '.txt');
  await fs.promises.writeFile(listPath, plan.concatListText(jobs.map((j) => ({ path: j.file, duration: j.g.frames / s.fps }))));
  const audio = TLC.audioClips(timeline).map((c) => ({ src: c.src, srcIn: c.srcIn, start: c.start, dur: c.dur, gain: c.gain }));
  const tmpOut = outPath + '.part.' + s.container;
  report({ phase: 'mux', pct: 0.88, done, total: pending.length, cached: cachedCount, segments: jobs.length });
  let buf = '';
  const r = await ff.ffmpeg(plan.finalArgs({ listPath, audioClips: audio, settings: s, totalDur: total, outPath: tmpOut }), {
    signal: ctl.signal,
    onStdout: (d) => {
      buf += d.toString();
      const m = buf.match(/out_time_us=(\d+)/g);
      if (m) {
        const us = parseInt(m[m.length - 1].split('=')[1], 10);
        report({ phase: 'mux', pct: 0.88 + 0.12 * Math.min(1, us / 1e6 / total), done, total: pending.length, cached: cachedCount, segments: jobs.length });
        buf = buf.slice(-400);
      }
    },
  }).catch((e) => ({ code: -1, stderr: String(e.message), cancelled: e.cancelled }));
  try { await fs.promises.unlink(listPath); } catch (_) { /* */ }
  if (r.code !== 0) {
    try { await fs.promises.unlink(tmpOut); } catch (_) { /* */ }
    if (r.cancelled) { const e = new Error('Export cancelled'); e.cancelled = true; throw e; }
    throw new Error('Final mux failed:\n' + (r.stderr || '').trim().split('\n').slice(-6).join('\n'));
  }
  await fs.promises.rename(tmpOut, outPath);
  const size = (await fs.promises.stat(outPath)).size;
  report({ phase: 'done', pct: 1, done, total: pending.length, cached: cachedCount, segments: jobs.length });
  return { outPath, size, seconds: (Date.now() - t0) / 1000, segments: jobs.length, encoded: pending.length, cached: cachedCount, encoder: s.encoder };
}

function TLCDuration(tl) { return tl.clips.reduce((m, c) => Math.max(m, c.start + c.dur), 0); }

module.exports = { renderProject };
