(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TLC = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  // Flattens the multi-track timeline into a gapless list of frame-exact video segments (top track wins).

  function flatten(tl, totalDur) {
    const fps = tl.fps;
    const vTracks = tl.tracks.filter((t) => t.kind === 'video').map((t) => t.id); // top first
    const clips = tl.clips.filter((c) => c.kind === 'video').map((c) => ({
      c, a: Math.round(c.start * fps), b: Math.round((c.start + c.dur) * fps), pri: vTracks.indexOf(c.track),
    }));
    const total = Math.round((totalDur !== undefined ? totalDur : Math.max(0, ...clips.map((x) => x.b / fps))) * fps);
    const cuts = new Set([0, total]);
    for (const x of clips) { if (x.a > 0 && x.a < total) cuts.add(x.a); if (x.b > 0 && x.b < total) cuts.add(x.b); }
    const pts = Array.from(cuts).sort((m, n) => m - n);
    const segs = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1];
      let top = null;
      for (const x of clips) if (x.a <= a && x.b >= b && (!top || x.pri < top.pri)) top = x;
      const last = segs[segs.length - 1];
      if (top && last && last.clip && last.clip.id === top.c.id && last.endFrame === a) {
        last.endFrame = b; last.frames = b - last.startFrame; last.dur = last.frames / fps;
        continue;
      }
      const seg = { startFrame: a, endFrame: b, frames: b - a, start: a / fps, dur: (b - a) / fps, fps };
      if (top) {
        const c = top.c;
        seg.clip = c; seg.src = c.src; seg.speed = c.speed || 1; seg.crop = c.crop || null;
        seg.srcIn = Math.max(0, c.srcIn + ((a - top.a) / fps) * seg.speed);
        seg.mediaId = c.mediaId;
      } else seg.black = true;
      segs.push(seg);
    }
    return segs;
  }

  function visibleAt(tl, t) {
    const vTracks = tl.tracks.filter((x) => x.kind === 'video').map((x) => x.id);
    let top = null;
    for (const c of tl.clips) {
      if (c.kind !== 'video' || t < c.start - 1e-6 || t >= c.start + c.dur - 1e-6) continue;
      if (!top || vTracks.indexOf(c.track) < vTracks.indexOf(top.track)) top = c;
    }
    return top ? { clip: top, srcTime: top.srcIn + (t - top.start) * (top.speed || 1) } : null;
  }

  const audioClips = (tl) => tl.clips.filter((c) => c.kind === 'audio').sort((a, b) => a.start - b.start);

  return { flatten, visibleAt, audioClips };
});
