'use strict';
// Timeline panel: ruler with beat markers, multi-track lanes, drag/trim/snap, waveform, zoom, playhead.
(function () {
  const LANE_H = { V2: 40, V1: 52, A1: 62, A2: 40 };
  const LABEL_W = 74;
  const lanes = $('lanes'), wrap = $('lanes-wrap'), labels = $('labels'), ruler = $('ruler'), rwrap = $('ruler-wrap');
  const beatCv = $('beatlines'), ph = $('playhead');
  const TLUI = (window.TLUI = {});
  let laneTop = {};

  const musicAn = () => {
    const c = S.timeline.clips.find((x) => x.track === 'A1' && x.kind === 'audio');
    return c ? S.analysis[c.mediaId] || null : (S.analysis[S.musicId] || null);
  };
  const px = () => S.pxPerSec;
  const tOfX = (x) => (x + wrap.scrollLeft) / px();

  function snapPoints(exceptId) {
    const pts = [S.playhead, 0];
    const an = musicAn();
    if (an) for (const b of an.beats) pts.push(b);
    for (const c of S.timeline.clips) if (c.id !== exceptId) { pts.push(c.start, c.start + c.dur); }
    return pts;
  }
  function snapped(t, exceptId, edgesDur) {
    if (!S.snap) return t;
    const thr = 9 / px();
    const pts = snapPoints(exceptId);
    const a = TL.snapTime(t, pts, thr);
    if (edgesDur === undefined) return a;
    const b = TL.snapTime(t + edgesDur, pts, thr) - edgesDur;
    return Math.abs(a - t) <= Math.abs(b - t) ? a : b;
  }

  // ---------- layout ----------
  function layout() {
    let y = 0; laneTop = {};
    labels.textContent = ''; lanes.textContent = '';
    for (const t of S.timeline.tracks) {
      const h = LANE_H[t.id] || 48;
      laneTop[t.id] = y;
      const l = document.createElement('div'); l.className = 'lbl'; l.style.height = h + 'px'; l.textContent = t.id; l.title = t.name;
      labels.appendChild(l);
      const ln = document.createElement('div'); ln.className = 'lane'; ln.dataset.track = t.id; ln.style.top = y + 'px'; ln.style.height = h + 'px';
      lanes.appendChild(ln);
      y += h;
    }
    lanes.style.height = y + 'px';
    const w = Math.max(S.duration() + 8, 40) * px();
    lanes.style.width = Math.max(w, wrap.clientWidth) + 'px';
  }
  const laneEl = (id) => lanes.querySelector(`.lane[data-track="${id}"]`);

  function clipEl(c) {
    const d = document.createElement('div');
    d.className = 'clip' + (c.kind === 'audio' ? ' a' : c.track === 'V2' ? ' v2' : '') + (c.category === 'parked' ? ' parked' : '') + (S.selected === c.id ? ' sel' : '');
    d.dataset.id = c.id;
    d.style.left = c.start * px() + 'px'; d.style.width = Math.max(2, c.dur * px()) + 'px';
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = c.name || ''; d.appendChild(nm);
    const l = document.createElement('div'); l.className = 'h l'; l.dataset.edge = 'start';
    const r = document.createElement('div'); r.className = 'h r'; r.dataset.edge = 'end';
    d.append(l, r);
    if (c.kind === 'audio') drawWave(d, c);
    return d;
  }

  function drawWave(d, c) {
    const wf = S.wfOf(c.mediaId);
    if (!wf) {
      const m = S.mediaOf(c);
      if (m && !S.analysis[m.id] && !S.analysisPending[m.id]) S.ensureAnalysis(m).catch(() => {});
      return;
    }
    const W = Math.max(1, Math.round(c.dur * px())), H = LANE_H[c.track] - 8;
    const TILE = 4096, dpr = 1;
    for (let x0 = 0; x0 < W; x0 += TILE) {
      const tw = Math.min(TILE, W - x0);
      const cv = document.createElement('canvas'); cv.width = tw * dpr; cv.height = H; cv.style.left = x0 + 'px'; cv.style.width = tw + 'px';
      const g = cv.getContext('2d'); g.fillStyle = 'rgba(120,255,206,.85)';
      for (let x = 0; x < tw; x++) {
        const t0 = c.srcIn + ((x0 + x) / px()) * (c.speed || 1), t1 = c.srcIn + ((x0 + x + 1) / px()) * (c.speed || 1);
        const i0 = Math.floor(t0 * 100), i1 = Math.max(i0 + 1, Math.ceil(t1 * 100));
        let m = 0; for (let i = i0; i < i1 && i < wf.length; i++) if (wf[i] > m) m = wf[i];
        const hh = Math.max(1, (m / 255) * H);
        g.fillRect(x, (H - hh) / 2, 1, hh);
      }
      d.appendChild(cv);
    }
  }

  function render() {
    layout();
    for (const c of S.timeline.clips) { const ln = laneEl(c.track); if (ln) ln.appendChild(clipEl(c)); }
    drawRuler(); drawBeats(); placePlayhead();
    const n = S.timeline.clips.filter((c) => c.track === 'V1').length;
    $('t-info').textContent = `${S.timeline.clips.length} clips · ${S.fmt(S.duration())} · ${S.timeline.fps} fps`;
    S.emit('clips-count', n);
  }

  // ---------- ruler / beat grid ----------
  function sizeCanvas(cv, w, h) {
    const dpr = window.devicePixelRatio || 1;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.width = w + 'px'; cv.style.height = h + 'px'; }
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h); return g;
  }
  function drawRuler() {
    const w = rwrap.clientWidth, h = 26, g = sizeCanvas(ruler, w, h);
    const x0 = wrap.scrollLeft, t0 = x0 / px(), t1 = (x0 + w) / px();
    const an = musicAn();
    g.font = '10px -apple-system, Helvetica, sans-serif'; g.textBaseline = 'top';
    if (an) {
      g.fillStyle = 'rgba(47,123,255,.18)';
      for (const b of an.breakdowns || []) g.fillRect(b.start * px() - x0, 0, (b.end - b.start) * px(), h);
    }
    const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120];
    const step = steps.find((s) => s * px() >= 70) || 300;
    g.fillStyle = '#8a909c'; g.strokeStyle = '#3a3f4b';
    for (let t = Math.floor(t0 / step) * step; t <= t1; t += step) {
      const x = Math.round(t * px() - x0) + 0.5;
      g.beginPath(); g.moveTo(x, 12); g.lineTo(x, h); g.stroke();
      g.fillText(S.fmtShort(t) + (step < 1 ? '.' + Math.round((t % 1) * 10) : ''), x + 3, 2);
    }
    if (an) {
      const beatPx = an.beatPeriod * px();
      if (beatPx >= 3) {
        g.strokeStyle = '#2f7bff';
        an.beats.forEach((b, i) => {
          if (b < t0 - 1 || b > t1 + 1) return;
          const isBar = i % 4 === an.downbeatPhase;
          const x = Math.round(b * px() - x0) + 0.5;
          g.beginPath(); g.moveTo(x, h - (isBar ? 9 : 4)); g.lineTo(x, h); g.stroke();
        });
      }
      g.fillStyle = '#ff8a2b';
      for (const d of an.drops || []) {
        const x = d.time * px() - x0; if (x < -8 || x > w + 8) continue;
        g.beginPath(); g.moveTo(x - 5, 1); g.lineTo(x + 5, 1); g.lineTo(x, 9); g.closePath(); g.fill();
      }
    }
  }
  function drawBeats() {
    const w = wrap.clientWidth, h = wrap.clientHeight, g = sizeCanvas(beatCv, w, h);
    const an = musicAn(); if (!an || an.beatPeriod * px() < 6) return;
    const x0 = wrap.scrollLeft, t0 = x0 / px(), t1 = (x0 + w) / px();
    an.beats.forEach((b, i) => {
      if (b < t0 || b > t1) return;
      const isBar = i % 4 === an.downbeatPhase;
      g.strokeStyle = isBar ? 'rgba(90,155,255,.35)' : 'rgba(255,255,255,.07)';
      const x = Math.round(b * px() - x0) + 0.5;
      g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke();
    });
  }
  function placePlayhead() {
    const x = S.playhead * px() - wrap.scrollLeft;
    ph.style.display = x < -2 || x > wrap.clientWidth + 2 ? 'none' : 'block';
    ph.style.left = LABEL_W + x + 'px';
  }

  // ---------- interactions ----------
  function scrubFrom(ev) {
    const r = rwrap.getBoundingClientRect();
    const move = (e) => Player.seek(snapped((e.clientX - r.left + wrap.scrollLeft) / px()));
    move(ev);
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
  }
  rwrap.addEventListener('mousedown', scrubFrom);

  function trackAtY(clientY) {
    const r = lanes.getBoundingClientRect(), y = clientY - r.top;
    for (const t of S.timeline.tracks) if (y >= laneTop[t.id] && y < laneTop[t.id] + (LANE_H[t.id] || 48)) return t;
    return null;
  }

  lanes.addEventListener('mousedown', (ev) => {
    if (ev.button !== 0) return;
    const ce = ev.target.closest('.clip');
    if (!ce) {
      S.selected = null; S.emit('selection'); render();
      const r = wrap.getBoundingClientRect();
      Player.seek(snapped((ev.clientX - r.left + wrap.scrollLeft) / px()));
      return;
    }
    const c = TL.getClip(S.timeline, ce.dataset.id);
    S.selected = c.id; S.emit('selection');
    document.querySelectorAll('.clip.sel').forEach((e) => e.classList.remove('sel')); ce.classList.add('sel');
    const edge = ev.target.dataset && ev.target.dataset.edge;
    const startX = ev.clientX, orig = { start: c.start, dur: c.dur, srcIn: c.srcIn, track: c.track };
    let moved = false;
    const onMove = (e) => {
      const dx = e.clientX - startX; if (Math.abs(dx) > 2 || moved) moved = true; if (!moved && !edge) return;
      if (edge) {
        TL.trimClip(S.timeline, c.id, edge, snapped(edge === 'start' ? orig.start + dx / px() : orig.start + orig.dur + dx / px(), c.id));
        ce.style.left = c.start * px() + 'px'; ce.style.width = Math.max(2, c.dur * px()) + 'px';
      } else {
        const ns = snapped(Math.max(0, orig.start + dx / px()), c.id, c.dur);
        ce.style.left = ns * px() + 'px'; ce.dataset.ns = ns;
        const tr = trackAtY(e.clientY);
        if (tr && tr.kind === c.kind) { const ln = laneEl(tr.id); if (ce.parentNode !== ln) ln.appendChild(ce); ce.dataset.tr = tr.id; }
      }
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp);
      if (!moved) { S.emit('selection'); return; }
      if (edge) { S.commit(); return; }
      const ok = TL.moveClip(S.timeline, c.id, parseFloat(ce.dataset.ns ?? orig.start), ce.dataset.tr || orig.track);
      if (!ok) { c.start = orig.start; c.track = orig.track; S.toast('No room for the clip there.', true); render(); } else S.commit();
    };
    document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
  });

  // library drag & drop
  lanes.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('text/ams-media')) { e.preventDefault(); const ln = e.target.closest('.lane'); lanes.querySelectorAll('.lane.over').forEach((x) => x.classList.remove('over')); if (ln) ln.classList.add('over'); } });
  lanes.addEventListener('dragleave', () => lanes.querySelectorAll('.lane.over').forEach((x) => x.classList.remove('over')));
  lanes.addEventListener('drop', (e) => {
    e.preventDefault(); lanes.querySelectorAll('.lane.over').forEach((x) => x.classList.remove('over'));
    const m = S.byId[e.dataTransfer.getData('text/ams-media')]; if (!m) return;
    const tr = trackAtY(e.clientY); if (!tr) return;
    const wantKind = m.kind === 'music' ? 'audio' : 'video';
    if (tr.kind !== wantKind) return S.toast(wantKind === 'audio' ? 'Drop music on an audio track.' : 'Drop footage on a video track.', true);
    const r = wrap.getBoundingClientRect();
    const t = snapped(Math.max(0, (e.clientX - r.left + wrap.scrollLeft) / px()));
    const dur = wantKind === 'audio' ? m.duration : Math.min(m.duration, 4);
    const c = TL.addClip(S.timeline, { kind: wantKind, track: tr.id, mediaId: m.id, src: m.path, name: m.name, srcDur: m.duration, srcIn: 0, start: t, dur, category: m.kind === 'parked' ? 'parked' : undefined });
    if (!c) return S.toast('No room for the clip there.', true);
    S.selected = c.id; S.commit(); S.requestProxiesFor([c]);
    if (m.kind === 'music') { S.musicId = m.id; S.ensureAnalysis(m).then(() => S.emit('music')); }
  });

  wrap.addEventListener('wheel', (e) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const rect = wrap.getBoundingClientRect(), tAt = (e.clientX - rect.left + wrap.scrollLeft) / px();
    TLUI.setZoom(px() * (e.deltaY < 0 ? 1.15 : 1 / 1.15), tAt, e.clientX - rect.left);
  }, { passive: false });
  wrap.addEventListener('scroll', () => { labels.scrollTop = wrap.scrollTop; drawRuler(); drawBeats(); placePlayhead(); });

  TLUI.setZoom = (v, anchorT, anchorX) => {
    S.pxPerSec = Math.max(2, Math.min(300, v)); $('t-zoom').value = S.pxPerSec;
    render();
    if (anchorT !== undefined) wrap.scrollLeft = anchorT * px() - anchorX;
    drawRuler(); drawBeats(); placePlayhead();
  };
  $('t-zoom').oninput = (e) => TLUI.setZoom(parseFloat(e.target.value), S.playhead, Math.min(200, wrap.clientWidth / 2));
  TLUI.fit = () => { const d = S.duration(); if (d > 0) TLUI.setZoom(Math.max(2, (wrap.clientWidth - 40) / d)); };

  S.on('timeline', render);
  S.on('selection', () => { document.querySelectorAll('.clip.sel').forEach((e) => e.classList.remove('sel')); const e = S.selected && lanes.querySelector(`.clip[data-id="${S.selected}"]`); if (e) e.classList.add('sel'); });
  S.on('analysis', () => render());
  S.on('music', () => { drawRuler(); drawBeats(); });
  S.on('playhead', () => {
    placePlayhead();
    if (S.playing) { const x = S.playhead * px() - wrap.scrollLeft; if (x > wrap.clientWidth - 40 || x < 0) { wrap.scrollLeft = S.playhead * px() - 80; } }
  });
  new ResizeObserver(() => { drawRuler(); drawBeats(); placePlayhead(); }).observe(wrap);
  render();
})();
