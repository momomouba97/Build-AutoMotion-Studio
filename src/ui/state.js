'use strict';
// Shared application state + tiny event bus + helpers (renderer process).
(function () {
  const $ = (id) => document.getElementById(id);
  const S = {
    name: 'Untitled', projectPath: null, dirty: false,
    media: { moving: [], parked: [], music: [] }, byId: {}, flags: {},
    thumbs: {}, proxies: {}, analysis: {}, wf: {}, musicId: null,
    timeline: TL.create(30), history: new TL.History(100),
    selected: null, playhead: 0, playing: false, pxPerSec: 60, snap: true,
    libTab: 'moving', libSel: null,
    settings: { cutMode: 'auto', parkedShare: 22, seed: null,
      export: { container: 'mp4', codec: 'h264', res: 1080, fps: 30, aspect: '16:9', mode: 'balanced', hw: 'auto', fadeOut: 1 } },
    config: null, presets: null,
  };
  S.history.reset(S.timeline);
  const L = {};
  S.on = (ev, fn) => { (L[ev] = L[ev] || []).push(fn); };
  S.emit = (ev, ...a) => { for (const fn of L[ev] || []) { try { fn(...a); } catch (e) { console.error(ev, e); } } };

  S.commit = () => { S.history.record(S.timeline); S.dirty = true; S.emit('timeline'); };
  S.setTimeline = (tl, fromHistory) => {
    S.timeline = tl;
    if (S.selected && !TL.getClip(tl, S.selected)) S.selected = null;
    S.emit('timeline');
    if (!fromHistory) S.dirty = true;
  };
  S.undo = () => { const t = S.history.undo(); if (t) S.setTimeline(t, true); };
  S.redo = () => { const t = S.history.redo(); if (t) S.setTimeline(t, true); };
  S.duration = () => TL.duration(S.timeline);

  S.fileUrl = (p) => 'file://' + p.split('/').map(encodeURIComponent).join('/');
  S.fmt = (t) => {
    t = Math.max(0, t || 0);
    const m = Math.floor(t / 60), s = t - m * 60;
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2);
  };
  S.fmtShort = (t) => { t = Math.round(t || 0); return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0'); };

  let toastTimer = null;
  S.toast = (msg, err) => {
    const t = $('toast');
    t.textContent = msg; t.className = err ? 'err' : ''; t.style.display = 'block';
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.style.display = 'none'; }, err ? 7000 : 3200);
  };
  S.busy = (msg) => { $('busy').style.display = msg ? 'flex' : 'none'; if (msg) $('busy-msg').textContent = msg; };

  S.addMedia = (items, kind) => {
    const list = S.media[kind];
    let added = 0;
    for (const it of items) {
      if (S.byId[it.id]) { Object.assign(S.byId[it.id], it, { missing: false }); continue; }
      it.kind = kind; S.byId[it.id] = it; list.push(it); added++;
    }
    S.emit('library');
    return added;
  };
  S.mediaOf = (clip) => S.byId[clip.mediaId] || null;
  S.isExcluded = (id) => S.flags[id] === 'excl';
  S.pools = () => {
    const mk = (m) => ({ id: m.id, path: m.path, name: m.name, duration: m.duration, fav: S.flags[m.id] === 'fav' });
    const ok = (m) => !m.missing && S.flags[m.id] !== 'excl';
    return { moving: S.media.moving.filter(ok).map(mk), parked: S.media.parked.filter(ok).map(mk) };
  };
  S.wfOf = (id) => {
    if (S.wf[id]) return S.wf[id];
    const a = S.analysis[id];
    if (!a || !a.waveform) return null;
    const bin = atob(a.waveform);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return (S.wf[id] = arr);
  };
  S.analysisPending = {};
  S.ensureAnalysis = async (item) => {
    if (S.analysis[item.id]) return S.analysis[item.id];
    if (!S.analysisPending[item.id]) {
      S.analysisPending[item.id] = window.ams.analyzeAudio(item).then((a) => { S.analysis[item.id] = a; S.emit('analysis', item.id); return a; })
        .finally(() => { delete S.analysisPending[item.id]; });
    }
    return S.analysisPending[item.id];
  };
  S.requestProxiesFor = (clips) => {
    const seen = new Set(), items = [];
    for (const c of clips) { const m = S.mediaOf(c); if (m && c.kind === 'video' && !seen.has(m.id) && !S.proxies[m.id]) { seen.add(m.id); items.push(m); } }
    if (items.length) window.ams.requestProxies(items);
  };
  window.S = S; window.$ = $;
})();
