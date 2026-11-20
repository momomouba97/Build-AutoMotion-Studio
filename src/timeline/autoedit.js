(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AE = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  // Auto Editing Engine: music analysis + footage pools -> beat-synced clips filling the whole track.

  function rng(seed) {
    let a = (seed >>> 0) || 1;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const UNIT = { '1beat': 1, '2beats': 2, '1bar': 4, '2bars': 8, '4bars': 16 };
  let cid = 0;
  const newId = () => 'ae' + Date.now().toString(36) + (cid++).toString(36) + Math.floor(Math.random() * 46656).toString(36);

  function energyAt(an, t) {
    const i = Math.min(an.energy.length - 1, Math.max(0, Math.floor(t / an.energyStep)));
    return an.energy[i] || 0;
  }
  function energyRange(an, a, b) {
    const i0 = Math.max(0, Math.floor(a / an.energyStep)), i1 = Math.min(an.energy.length, Math.max(i0 + 1, Math.ceil(b / an.energyStep)));
    let s = 0;
    for (let i = i0; i < i1; i++) s += an.energy[i];
    return s / Math.max(1, i1 - i0);
  }
  const nearestIdx = (arr, t) => {
    let lo = 0, hi = arr.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < t) lo = m + 1; else hi = m; }
    if (lo > 0 && Math.abs(arr[lo - 1] - t) < Math.abs(arr[lo] - t)) lo--;
    return lo;
  };

  // Beat indices at which cuts happen (always strictly increasing).
  function cutBeatIndices(an, mode) {
    const beats = an.beats;
    const phase = an.downbeatPhase || 0;
    const dropIdx = (an.drops || []).map((d) => nearestIdx(beats, d.time));
    const bdRanges = an.breakdowns || [];
    let i = beats.findIndex((t) => t >= 0.3);
    if (i < 0) return [];
    const idxs = [];
    const fixed = UNIT[mode];
    if (fixed && fixed >= 4) { while (i < beats.length && (i % 4) !== phase) i++; }
    while (i < beats.length) {
      idxs.push(i);
      const t = beats[i];
      let unit;
      if (fixed) unit = fixed;
      else {
        const inBd = bdRanges.find((b) => t >= b.start - 1e-3 && t < b.end - 1e-3);
        const afterDrop = (an.drops || []).some((d) => t >= d.time - 1e-3 && t < d.time + (8 * 60) / an.bpm);
        const e = energyAt(an, t);
        if (inBd) unit = 8;
        else if (afterDrop) unit = 1;
        else unit = e > 0.8 ? 1 : e > 0.6 ? 2 : e > 0.4 ? 4 : 8;
        if (unit >= 4) { const toBar = 4 - ((((i - phase) % 4) + 4) % 4); if (toBar !== 4) unit = Math.min(unit, toBar); }
        if (inBd) { const bd = inBd; const eIdx = nearestIdx(beats, bd.end); if (eIdx > i) unit = Math.min(unit, eIdx - i); }
      }
      // land exactly on the next drop
      const nd = dropIdx.filter((d) => d > i).sort((a, b) => a - b)[0];
      if (nd !== undefined && i + unit > nd) unit = nd - i;
      i += Math.max(1, unit);
    }
    return idxs;
  }

  function boundaries(an, mode, fps) {
    const total = Math.round(an.duration * fps);
    const frames = [0];
    for (const bi of cutBeatIndices(an, mode)) {
      const f = Math.round(an.beats[bi] * fps);
      if (f > frames[frames.length - 1] && f < total) frames.push(f);
    }
    // absorb a too-short tail
    while (frames.length > 1 && total - frames[frames.length - 1] < Math.round(0.3 * fps)) frames.pop();
    frames.push(total);
    return frames;
  }

  function overlapAmount(ranges, a, b) {
    let o = 0;
    for (const r of ranges) o += Math.max(0, Math.min(b, r[1]) - Math.max(a, r[0]));
    return o;
  }

  class Picker {
    constructor(pools, rand, fps) {
      this.pools = pools; this.rand = rand; this.fps = fps;
      this.uses = new Map(); this.ranges = new Map(); this.last = null;
    }
    registerRange(path, a, b) {
      if (!this.ranges.has(path)) this.ranges.set(path, []);
      this.ranges.get(path).push([a - 0.25, b + 0.25]);
      this.uses.set(path, (this.uses.get(path) || 0) + 1);
    }
    // Pick a (media, srcIn, dur) for `need` seconds from the pool, avoiding repeats.
    pick(cat, need, avoidPath) {
      let pool = this.pools[cat] && this.pools[cat].length ? this.pools[cat] : this.pools[cat === 'moving' ? 'parked' : 'moving'];
      if (!pool || !pool.length) return null;
      const fit = pool.filter((m) => m.duration >= need + 0.05);
      let cand = fit.length ? fit : [pool.reduce((a, b) => (b.duration > a.duration ? b : a))];
      const score = (m) => (this.uses.get(m.path) || 0) / (m.fav ? 2 : 1);
      let minScore = Infinity;
      for (const m of cand) minScore = Math.min(minScore, score(m));
      let best = cand.filter((m) => score(m) <= minScore + 1e-9);
      const noRepeat = best.filter((m) => m.path !== this.last && m.path !== avoidPath);
      if (noRepeat.length) best = noRepeat;
      else { const alt = cand.filter((m) => m.path !== this.last && m.path !== avoidPath); if (alt.length) best = alt; }
      const m = best[Math.floor(this.rand() * best.length)];
      const dur = Math.min(need, m.duration - 0.05);
      const margin = Math.min(0.5, Math.max(0, (m.duration - dur) / 2));
      const lo = margin, hi = Math.max(lo, m.duration - dur - margin);
      const used = this.ranges.get(m.path) || [];
      let bestStart = lo, bestOv = Infinity;
      for (let k = 0; k < 40; k++) {
        const s = lo + this.rand() * (hi - lo);
        const ov = overlapAmount(used, s, s + dur);
        if (ov < bestOv) { bestOv = ov; bestStart = s; if (ov === 0) break; }
      }
      const s = Math.round(bestStart * this.fps) / this.fps;
      return { media: m, srcIn: s, dur };
    }
  }

  // options: {seed, cutMode, fps, parkedShare(0..0.6), track}
  function generate({ analysis, pools, options }) {
    const o = Object.assign({ seed: 1, cutMode: 'auto', fps: 30, parkedShare: 0.22, track: 'V1' }, options || {});
    const fps = o.fps;
    const rand = rng(o.seed);
    const frames = boundaries(analysis, o.cutMode, fps);
    const segs = [];
    for (let i = 0; i + 1 < frames.length; i++) {
      const a = frames[i] / fps, b = frames[i + 1] / fps;
      segs.push({ a, b, f0: frames[i], f1: frames[i + 1], e: energyRange(analysis, a, b) });
    }
    const hasParked = pools.parked && pools.parked.length, hasMoving = pools.moving && pools.moving.length;
    if (!hasParked && !hasMoving) throw new Error('No footage available');
    const sorted = segs.map((s) => s.e).sort((x, y) => x - y);
    const thr = hasParked && hasMoving ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * o.parkedShare))] : -1;
    const picker = new Picker(pools, rand, fps);
    const clips = [];
    let parkedCount = 0, movingCount = 0;
    for (const s of segs) {
      const inBd = (analysis.breakdowns || []).some((b) => s.a >= b.start - 1e-3 && s.a < b.end - 1e-3);
      const onDrop = (analysis.drops || []).some((d) => Math.abs(d.time - s.a) < 0.12);
      let cat = (inBd || (o.parkedShare > 0 && s.e <= thr && s.e < 0.5)) ? 'parked' : 'moving';
      if (onDrop) cat = 'moving';
      if (cat === 'parked' && !hasParked) cat = 'moving';
      if (cat === 'moving' && !hasMoving) cat = 'parked';
      let f = s.f0;
      while (f < s.f1) {
        const need = (s.f1 - f) / fps;
        const p = picker.pick(cat, need, null);
        if (!p) break;
        let df = Math.max(1, Math.round(p.dur * fps));
        if (df > s.f1 - f) df = s.f1 - f;
        const dur = df / fps;
        picker.registerRange(p.media.path, p.srcIn, p.srcIn + dur);
        picker.last = p.media.path;
        clips.push({
          id: newId(), track: o.track, kind: 'video', mediaId: p.media.id, src: p.media.path, name: p.media.name,
          srcDur: p.media.duration, srcIn: p.srcIn, start: f / fps, dur, speed: 1, crop: null, category: cat,
        });
        f += df;
        if (cat === 'parked') parkedCount++; else movingCount++;
      }
    }
    return { clips, stats: { segments: segs.length, clips: clips.length, moving: movingCount, parked: parkedCount, cutMode: o.cutMode } };
  }

  // Replace one clip's footage without touching anything else (same slot, same category).
  function regenerateClip(timelineClips, clipId, pools, options) {
    const o = Object.assign({ seed: Date.now() % 100000, fps: 30 }, options || {});
    const clip = timelineClips.find((c) => c.id === clipId);
    if (!clip || clip.kind !== 'video') return null;
    const picker = new Picker(pools, rng(o.seed), o.fps);
    const sorted = timelineClips.filter((c) => c.track === clip.track).sort((a, b) => a.start - b.start);
    const idx = sorted.findIndex((c) => c.id === clipId);
    for (const c of timelineClips) if (c.kind === 'video' && c.id !== clipId) picker.registerRange(c.src, c.srcIn, c.srcIn + c.dur * (c.speed || 1));
    const avoid = new Set([clip.src, sorted[idx - 1] && sorted[idx - 1].src, sorted[idx + 1] && sorted[idx + 1].src]);
    const cat = clip.category || 'moving';
    const poolKeys = [cat, cat === 'moving' ? 'parked' : 'moving'];
    let result = null;
    for (const strict of [true, false]) {
      for (const k of poolKeys) {
        const src = (pools[k] || []).filter((m) => !strict || !avoid.has(m.path));
        if (!src.length) continue;
        const p = new Picker({ moving: src, parked: src }, rng(o.seed + (strict ? 0 : 7)), o.fps);
        p.ranges = picker.ranges; p.uses = picker.uses;
        result = p.pick(k, clip.dur * (clip.speed || 1), null);
        if (result) { result.cat = k; break; }
      }
      if (result) break;
    }
    if (!result) return null;
    const dur = Math.min(clip.dur, result.dur / (clip.speed || 1));
    return Object.assign({}, clip, {
      mediaId: result.media.id, src: result.media.path, name: result.media.name, srcDur: result.media.duration,
      srcIn: result.srcIn, dur: Math.round(dur * o.fps) / o.fps, category: result.cat,
    });
  }

  return { generate, regenerateClip, boundaries, rng, UNIT };
});
