'use strict';
// Preview engine: double-buffered <video> elements driven by the flattened timeline, audio synced to the clock.
(function () {
  const els = [$('vA'), $('vB')];
  const frame = $('frame'), stage = $('stage');
  const audio = { A1: new Audio(), A2: new Audio() };
  let active = 0, segs = [], startWall = 0, startT = 0, raf = 0, lastLayout = '';
  const P = (window.Player = {});

  const segId = (g) => g.startFrame + '|' + g.clip.id + '|' + P.quality() + (S.proxies[g.mediaId] ? 'p' : '');
  P.quality = () => $('pq').value;

  function rebuild() { segs = TLC.flatten(S.timeline, S.duration()); }
  function segIndex(t) {
    const f = t * S.timeline.fps + 1e-6;
    let lo = 0, hi = segs.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (segs[m].startFrame <= f) lo = m; else hi = m - 1; }
    return segs.length ? lo : -1;
  }
  const srcTimeAt = (g, t) => g.srcIn + (t - g.start) * g.speed;
  const srcUrl = (g) => {
    const useProxy = P.quality() === 'proxy' && S.proxies[g.mediaId];
    return S.fileUrl(useProxy ? S.proxies[g.mediaId] : g.src);
  };

  function load(el, g, t) {
    const id = segId(g);
    if (el.dataset.seg !== id) {
      el.dataset.seg = id;
      const url = srcUrl(g);
      if (el.getAttribute('src') !== url) el.src = url;
    }
    try { el.currentTime = srcTimeAt(g, t); } catch (_) { /* metadata not ready yet */ }
    el.playbackRate = g.speed || 1;
  }

  function layoutFrame() {
    const [aw, ah] = S.settings.export.aspect.split(':').map(Number);
    const ar = aw / ah;
    const W = stage.clientWidth, H = stage.clientHeight;
    let w = W, h = W / ar;
    if (h > H) { h = H; w = H * ar; }
    frame.style.width = Math.floor(w) + 'px'; frame.style.height = Math.floor(h) + 'px';
  }
  function layoutVideo(el, g) {
    const m = S.mediaOf(g.clip) || {};
    const sw = m.width || el.videoWidth || 1920, sh = m.height || el.videoHeight || 1080;
    const Cw = frame.clientWidth, Ch = frame.clientHeight;
    const c = g.crop || { x: 0, y: 0, w: 1, h: 1 };
    const s = Math.max(Cw / (c.w * sw), Ch / (c.h * sh));
    const key = [Cw, Ch, sw, sh, c.x, c.y, c.w, c.h].join();
    if (el.dataset.lay === key) return;
    el.dataset.lay = key;
    el.style.width = sw * s + 'px'; el.style.height = sh * s + 'px';
    el.style.left = Cw / 2 - (c.x + c.w / 2) * sw * s + 'px';
    el.style.top = Ch / 2 - (c.y + c.h / 2) * sh * s + 'px';
  }

  function show(t) {
    const k = segIndex(t), g = segs[k];
    const a = els[active], b = els[1 - active];
    if (!g || g.black) { a.classList.add('hidden'); b.classList.add('hidden'); a.pause(); b.pause(); return; }
    if (a.dataset.seg !== segId(g)) {
      if (b.dataset.seg === segId(g)) { active = 1 - active; a.pause(); }
      else load(a, g, t);
    }
    const cur = els[active], other = els[1 - active];
    cur.classList.remove('hidden'); other.classList.add('hidden');
    layoutVideo(cur, g);
    const want = srcTimeAt(g, t);
    if (S.playing) {
      if (cur.paused) cur.play().catch(() => {});
      if (Math.abs(cur.currentTime - want) > 0.3) cur.currentTime = want;
    } else if (Math.abs(cur.currentTime - want) > 0.017) cur.currentTime = want;
    // preload the next cut in the hidden element
    const nx = segs[k + 1];
    if (nx && !nx.black && other.dataset.seg !== segId(nx)) { load(other, nx, nx.start); other.pause(); }
  }

  function syncAudio(t) {
    for (const tr of ['A1', 'A2']) {
      const el = audio[tr];
      const c = S.timeline.clips.find((x) => x.track === tr && t >= x.start && t < x.start + x.dur);
      if (!c || !S.playing) { if (!el.paused) el.pause(); continue; }
      const url = S.fileUrl(c.src);
      if (el.dataset.u !== url) { el.dataset.u = url; el.src = url; }
      const want = c.srcIn + (t - c.start);
      el.volume = Math.max(0, Math.min(1, c.gain === undefined ? 1 : c.gain));
      if (el.paused) { el.currentTime = want; el.play().catch(() => {}); }
      else if (Math.abs(el.currentTime - want) > 0.2) el.currentTime = want;
    }
  }

  function setPlayhead(t) {
    S.playhead = t;
    S.emit('playhead', t);
  }

  function tick() {
    if (!S.playing) return;
    const t = startT + (performance.now() - startWall) / 1000;
    const dur = S.duration();
    if (t >= dur) { P.pause(); setPlayhead(dur); show(Math.max(0, dur - 1e-3)); return; }
    setPlayhead(t); show(t); syncAudio(t);
    raf = requestAnimationFrame(tick);
  }

  P.play = () => {
    if (S.playing || !S.duration()) return;
    if (S.playhead >= S.duration() - 0.05) S.playhead = 0;
    S.playing = true; startWall = performance.now(); startT = S.playhead;
    $('b-play').textContent = 'Pause';
    raf = requestAnimationFrame(tick);
  };
  P.pause = () => {
    S.playing = false; cancelAnimationFrame(raf);
    els.forEach((e) => e.pause()); Object.values(audio).forEach((a) => a.pause());
    $('b-play').textContent = 'Play';
  };
  P.toggle = () => (S.playing ? P.pause() : P.play());
  P.seek = (t) => {
    t = Math.max(0, Math.min(S.duration(), t));
    setPlayhead(t);
    if (S.playing) { startWall = performance.now(); startT = t; }
    show(Math.min(t, Math.max(0, S.duration() - 1e-3)));
  };
  P.step = (frames) => P.seek(Math.round(S.playhead * S.timeline.fps + frames) / S.timeline.fps);
  P.refresh = () => { rebuild(); els.forEach((e) => { delete e.dataset.seg; }); show(Math.min(S.playhead, Math.max(0, S.duration() - 1e-3))); };

  $('b-play').onclick = P.toggle;
  $('b-stepb').onclick = () => P.step(-1);
  $('b-stepf').onclick = () => P.step(1);
  $('b-full').onclick = () => { if (document.fullscreenElement) document.exitFullscreen(); else stage.requestFullscreen(); };
  $('pq').onchange = () => P.refresh();
  $('seek').oninput = (e) => P.seek((e.target.value / 1000) * S.duration());
  new ResizeObserver(() => { layoutFrame(); els.forEach((e) => { delete e.dataset.lay; }); if (segs.length) show(S.playhead); }).observe(stage);

  S.on('timeline', () => { rebuild(); els.forEach((e) => { delete e.dataset.seg; }); const d = S.duration(); if (S.playhead > d) S.playhead = d; show(Math.min(S.playhead, Math.max(0, d - 1e-3))); S.emit('playhead', S.playhead); });
  S.on('aspect', () => { layoutFrame(); els.forEach((e) => { delete e.dataset.lay; }); show(S.playhead); });
  S.on('playhead', (t) => {
    const d = S.duration() || 1;
    $('osd').textContent = S.fmt(t);
    $('tc').textContent = S.fmt(t) + ' / ' + S.fmt(S.duration());
    $('seek').value = Math.round((t / d) * 1000);
  });
  window.ams.on('proxy:ready', ({ id, path }) => { S.proxies[id] = path; });
  layoutFrame(); void lastLayout;
})();
