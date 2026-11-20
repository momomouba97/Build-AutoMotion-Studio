(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TL = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  // Timeline data model + editing operations. Pure functions on a plain-JSON timeline (undo = snapshots).
  const EPS = 1e-6;
  const MIN_DUR = 1 / 120;
  let counter = 0;
  const uid = () => 'c' + Date.now().toString(36) + (counter++).toString(36) + Math.floor(Math.random() * 1296).toString(36);

  const q = (t, fps) => Math.round(t * fps) / fps;
  const end = (c) => c.start + c.dur;

  function create(fps) {
    return {
      fps: fps || 30,
      // order = visual order top -> bottom; higher in the list wins when video tracks overlap
      tracks: [
        { id: 'V2', kind: 'video', name: 'Video 2' },
        { id: 'V1', kind: 'video', name: 'Video 1' },
        { id: 'A1', kind: 'audio', name: 'Music' },
        { id: 'A2', kind: 'audio', name: 'Audio 2' },
      ],
      clips: [],
    };
  }
  const clone = (tl) => JSON.parse(JSON.stringify(tl));
  const getClip = (tl, id) => tl.clips.find((c) => c.id === id) || null;
  const trackOf = (tl, id) => tl.tracks.find((t) => t.id === id) || null;
  const trackClips = (tl, trackId, exceptId) =>
    tl.clips.filter((c) => c.track === trackId && c.id !== exceptId).sort((a, b) => a.start - b.start);
  const duration = (tl) => tl.clips.reduce((m, c) => Math.max(m, end(c)), 0);
  const sourceLimit = (c) => (c.srcDur ? (c.srcDur - c.srcIn) / (c.speed || 1) : Infinity);

  // Nearest start >= 0 where a clip of `dur` fits on the track without overlapping others.
  function fitStart(tl, trackId, id, desired, dur) {
    const others = trackClips(tl, trackId, id);
    const gaps = [];
    let cursor = 0;
    for (const o of others) {
      if (o.start - cursor >= dur - EPS) gaps.push([cursor, o.start]);
      cursor = Math.max(cursor, end(o));
    }
    gaps.push([cursor, Infinity]);
    let best = null, bestD = Infinity;
    for (const [a, b] of gaps) {
      const s = Math.min(Math.max(desired, a), b - dur);
      if (s < a - EPS) continue;
      const d = Math.abs(s - desired);
      if (d < bestD) { bestD = d; best = s; }
    }
    return best === null ? null : Math.max(0, best);
  }

  function addClip(tl, clip) {
    const c = Object.assign({ id: uid(), speed: 1, crop: null, gain: 1, srcIn: 0 }, clip);
    c.start = q(c.start || 0, tl.fps);
    c.dur = Math.max(MIN_DUR, q(c.dur, tl.fps));
    const s = fitStart(tl, c.track, null, c.start, c.dur);
    if (s === null) return null;
    c.start = q(s, tl.fps);
    tl.clips.push(c);
    return c;
  }

  function moveClip(tl, id, start, trackId) {
    const c = getClip(tl, id);
    if (!c) return false;
    const target = trackId || c.track;
    const t = trackOf(tl, target);
    if (!t || t.kind !== c.kind) return false;
    const s = fitStart(tl, target, id, Math.max(0, q(start, tl.fps)), c.dur);
    if (s === null) return false;
    c.track = target;
    c.start = q(s, tl.fps);
    return true;
  }

  function splitClip(tl, id, time) {
    const c = getClip(tl, id);
    if (!c) return null;
    const t = q(time, tl.fps);
    if (t <= c.start + 1 / tl.fps - EPS || t >= end(c) - 1 / tl.fps + EPS) return null;
    const right = Object.assign({}, c, { id: uid(), start: t, dur: q(end(c) - t, tl.fps) });
    right.srcIn = c.srcIn + (t - c.start) * (c.speed || 1);
    c.dur = q(t - c.start, tl.fps);
    tl.clips.push(right);
    return right;
  }

  // edge: 'start' | 'end'; time = new timeline time of that edge
  function trimClip(tl, id, edge, time) {
    const c = getClip(tl, id);
    if (!c) return false;
    const fps = tl.fps, frame = 1 / fps;
    const t = q(time, fps);
    const others = trackClips(tl, c.track, id);
    if (edge === 'start') {
      const prev = others.filter((o) => end(o) <= c.start + EPS).pop();
      let lo = prev ? end(prev) : 0;
      lo = Math.max(lo, c.start - c.srcIn / (c.speed || 1)); // cannot reveal before source start
      const oldEnd = end(c);
      const ns = q(Math.min(Math.max(t, lo), oldEnd - frame), fps);
      const delta = ns - c.start;
      c.srcIn = Math.max(0, c.srcIn + delta * (c.speed || 1));
      c.start = ns;
      c.dur = q(oldEnd - ns, fps);
    } else {
      const next = others.find((o) => o.start >= end(c) - EPS);
      let hi = next ? next.start : Infinity;
      hi = Math.min(hi, c.start + sourceLimit(c));
      const ne = Math.max(Math.min(t, hi), c.start + frame);
      c.dur = q(ne - c.start, fps);
    }
    return true;
  }

  function deleteClip(tl, id) {
    const i = tl.clips.findIndex((c) => c.id === id);
    if (i < 0) return false;
    tl.clips.splice(i, 1);
    return true;
  }

  // Delete and close the gap on the same track.
  function rippleDelete(tl, id) {
    const c = getClip(tl, id);
    if (!c) return false;
    const { track, dur } = c, from = end(c);
    deleteClip(tl, id);
    for (const o of tl.clips) if (o.track === track && o.start >= from - EPS) o.start = q(o.start - dur, tl.fps);
    return true;
  }

  function duplicateClip(tl, id) {
    const c = getClip(tl, id);
    if (!c) return null;
    const copy = Object.assign({}, c, { id: uid(), crop: c.crop ? Object.assign({}, c.crop) : null });
    const s = fitStart(tl, c.track, null, end(c), c.dur);
    if (s === null) return null;
    copy.start = q(s, tl.fps);
    tl.clips.push(copy);
    return copy;
  }

  // media: {id, path, name, duration, width, height}
  function replaceClip(tl, id, media) {
    const c = getClip(tl, id);
    if (!c) return false;
    c.mediaId = media.id; c.src = media.path; c.name = media.name; c.srcDur = media.duration;
    const maxIn = Math.max(0, media.duration - c.dur * (c.speed || 1));
    c.srcIn = Math.min(c.srcIn, maxIn);
    const limit = sourceLimit(c);
    if (c.dur > limit) c.dur = q(Math.max(MIN_DUR, limit), tl.fps);
    return true;
  }

  function setCrop(tl, id, crop) {
    const c = getClip(tl, id);
    if (!c) return false;
    if (!crop) { c.crop = null; return true; }
    const x = Math.min(0.95, Math.max(0, crop.x)), y = Math.min(0.95, Math.max(0, crop.y));
    c.crop = { x, y, w: Math.min(1 - x, Math.max(0.05, crop.w)), h: Math.min(1 - y, Math.max(0.05, crop.h)) };
    return true;
  }

  function snapTime(t, points, threshold) {
    let best = t, bd = threshold;
    for (const p of points) { const d = Math.abs(p - t); if (d <= bd) { bd = d; best = p; } }
    return best;
  }

  // Test helper: returns list of problems (overlaps, negative values)
  function validate(tl) {
    const problems = [];
    for (const t of tl.tracks) {
      const cs = trackClips(tl, t.id);
      for (let i = 0; i < cs.length; i++) {
        if (cs[i].start < -EPS || cs[i].dur <= 0) problems.push('bad clip ' + cs[i].id);
        if (i && cs[i].start < end(cs[i - 1]) - 1e-4) problems.push('overlap on ' + t.id);
      }
    }
    return problems;
  }

  class History {
    constructor(limit) { this.limit = limit || 100; this.stack = []; this.i = -1; }
    reset(tl) { this.stack = [JSON.stringify(tl)]; this.i = 0; }
    record(tl) {
      this.stack = this.stack.slice(0, this.i + 1);
      this.stack.push(JSON.stringify(tl));
      if (this.stack.length > this.limit) this.stack.shift();
      this.i = this.stack.length - 1;
    }
    canUndo() { return this.i > 0; }
    canRedo() { return this.i < this.stack.length - 1; }
    undo() { if (!this.canUndo()) return null; this.i--; return JSON.parse(this.stack[this.i]); }
    redo() { if (!this.canRedo()) return null; this.i++; return JSON.parse(this.stack[this.i]); }
  }

  return { EPS, uid, q, end, create, clone, getClip, trackOf, trackClips, duration, fitStart, addClip, moveClip, splitClip,
    trimClip, deleteClip, rippleDelete, duplicateClip, replaceClip, setCrop, snapTime, validate, sourceLimit, History };
});
