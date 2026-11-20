'use strict';
const test = require('node:test');
const assert = require('node:assert');
const TL = require('../src/timeline/model');
const TLC = require('../src/timeline/compile');
const AE = require('../src/timeline/autoedit');
const { analyze } = require('../src/audio/analyzer');
const { synthTrack } = require('./helpers/synth');

const vclip = (o) => Object.assign({ kind: 'video', track: 'V1', src: '/x.mp4', mediaId: 'x', srcIn: 0, srcDur: 100 }, o);

test('split / trim / ripple / duplicate / replace / undo-redo', () => {
  const tl = TL.create(30);
  const a = TL.addClip(tl, vclip({ start: 0, dur: 4, srcIn: 10 }));
  const b = TL.addClip(tl, vclip({ start: 4, dur: 2, src: '/y.mp4', mediaId: 'y' }));
  const h = new TL.History(); h.reset(tl);
  const r = TL.splitClip(tl, a.id, 1.5);
  assert.ok(r); assert.strictEqual(a.dur, 1.5); assert.strictEqual(r.srcIn, 11.5); assert.strictEqual(r.dur, 2.5);
  h.record(tl);
  assert.strictEqual(TL.splitClip(tl, a.id, 0), null);
  TL.trimClip(tl, r.id, 'start', 2); // start edge to 2.0 => srcIn 12
  assert.ok(Math.abs(r.srcIn - 12) < 1e-9 && Math.abs(r.start - 2) < 1e-9 && Math.abs(r.dur - 2) < 1e-9);
  TL.trimClip(tl, r.id, 'end', 3.5);
  assert.ok(Math.abs(r.dur - 1.5) < 1e-9);
  TL.rippleDelete(tl, r.id);
  assert.ok(Math.abs(b.start - 4) < 1e-9 || Math.abs(b.start - 2.5) < 1e-9);
  assert.deepStrictEqual(TL.validate(tl), []);
  const d = TL.duplicateClip(tl, b.id); assert.ok(d && d.start >= TL.end(b) - 1e-9);
  assert.ok(TL.replaceClip(tl, d.id, { id: 'z', path: '/z.mp4', name: 'z', duration: 1 }));
  assert.ok(d.dur <= 1 + 1e-9);
  assert.ok(!TL.moveClip(tl, a.id, 0, 'A1'), 'cannot move video onto audio track');
  const back = h.undo(); assert.strictEqual(back.clips.length, 2);
  assert.ok(h.redo().clips.length === 3);
  assert.deepStrictEqual(TL.validate(tl), []);
});

test('flatten: top track wins, gaps become black, frames exact', () => {
  const tl = TL.create(30);
  TL.addClip(tl, vclip({ start: 0, dur: 4 }));
  TL.addClip(tl, vclip({ track: 'V2', start: 1, dur: 1, src: '/o.mp4', mediaId: 'o' }));
  const segs = TLC.flatten(tl, 6);
  assert.deepStrictEqual(segs.map((s) => [s.startFrame, s.endFrame]), [[0, 30], [30, 60], [60, 120], [120, 180]]);
  assert.strictEqual(segs[1].src, '/o.mp4'); assert.ok(segs[3].black);
  assert.ok(Math.abs(segs[2].srcIn - 2) < 1e-9);
  assert.strictEqual(TLC.visibleAt(tl, 1.2).clip.src, '/o.mp4');
});

test('auto edit fills the music, snaps to beats, avoids repeats, regenerates one clip', () => {
  const { samples, sr } = synthTrack({ bpm: 124, seconds: 60, offset: 0.15, breakdown: [24, 36] });
  const an = analyze(samples, sr);
  const mk = (p, n, d) => Array.from({ length: n }, (_, i) => ({ id: p + i, path: `/${p}${i}.mp4`, name: p + i, duration: d, fav: i === 0 }));
  const pools = { moving: mk('m', 6, 40), parked: mk('p', 3, 25) };
  for (const mode of ['auto', '1beat', '2beats', '1bar', '2bars', '4bars']) {
    const { clips, stats } = AE.generate({ analysis: an, pools, options: { seed: 5, cutMode: mode, fps: 30 } });
    const tl = TL.create(30); tl.clips = clips;
    assert.deepStrictEqual(TL.validate(tl), [], mode);
    assert.ok(Math.abs(TL.duration(tl) - an.duration) < 1 / 30 + 1e-6, mode + ' duration ' + TL.duration(tl));
    const sorted = clips.slice().sort((a, b) => a.start - b.start);
    for (let i = 1; i < sorted.length; i++) assert.ok(Math.abs(sorted[i].start - TL.end(sorted[i - 1])) < 1e-6, 'gapless ' + mode);
    for (const c of clips) assert.ok(c.srcIn >= 0 && c.srcIn + c.dur <= c.srcDur + 1e-6, 'within source');
    // cut times near beats (except first/last)
    const cuts = sorted.slice(1).map((c) => c.start);
    const near = cuts.filter((t) => an.beats.some((b) => Math.abs(b - t) < 1 / 30 + 0.02));
    assert.ok(near.length / cuts.length > 0.95, `${mode} beat-aligned ${near.length}/${cuts.length}`);
    // no overlapping source ranges when avoidable
    const byPath = {};
    for (const c of clips) (byPath[c.src] = byPath[c.src] || []).push([c.srcIn, c.srcIn + c.dur]);
    let overlaps = 0;
    for (const r of Object.values(byPath)) for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) if (Math.min(r[i][1], r[j][1]) - Math.max(r[i][0], r[j][0]) > 0.01) overlaps++;
    assert.ok(overlaps <= 1, mode + ' overlaps ' + overlaps);
    if (mode === 'auto') assert.ok(stats.parked > 0, 'parked used on low energy');
  }
  // variations differ, same analysis
  const v1 = AE.generate({ analysis: an, pools, options: { seed: 1 } }).clips.map((c) => c.src + c.srcIn).join();
  const v2 = AE.generate({ analysis: an, pools, options: { seed: 2 } }).clips.map((c) => c.src + c.srcIn).join();
  assert.notStrictEqual(v1, v2);
  // regenerate one clip only
  const { clips } = AE.generate({ analysis: an, pools, options: { seed: 9 } });
  const target = clips[3];
  const nc = AE.regenerateClip(clips, target.id, pools, { seed: 77, fps: 30 });
  assert.ok(nc && nc.start === target.start && Math.abs(nc.dur - target.dur) < 1e-6);
  assert.ok(nc.src !== target.src || nc.srcIn !== target.srcIn);
});
