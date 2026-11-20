'use strict';
// Application wiring: top bar, auto-edit flow, timeline tools, shortcuts, project files.
(function () {
  const App = (window.App = {});
  const rndSeed = () => 1 + Math.floor(Math.random() * 999998);
  const X = () => S.settings.export;

  // ---------- Auto edit ----------
  async function autoEdit(variation) {
    const music = S.byId[S.musicId] || S.media.music[0];
    if (!music) { showPane('auto'); return S.toast('Import a music track first (Music tab → Import).', true); }
    const pools = S.pools();
    if (!pools.moving.length && !pools.parked.length) return S.toast('Import moving and/or parked car footage first.', true);
    Player.pause();
    S.busy(S.analysis[music.id] ? 'Building edit…' : 'Analyzing music (BPM, kicks, drops)… first time only');
    let an;
    try { S.musicId = music.id; an = await S.ensureAnalysis(music); }
    catch (e) { S.busy(null); return S.toast('Music analysis failed: ' + e.message, true); }
    await new Promise((r) => setTimeout(r, 30));
    try {
      if (variation || !S.settings.seed) S.settings.seed = rndSeed();
      $('s-seed').value = S.settings.seed;
      const t0 = performance.now();
      const res = AE.generate({ analysis: an, pools, options: { seed: S.settings.seed, cutMode: S.settings.cutMode, fps: X().fps, parkedShare: S.settings.parkedShare / 100 } });
      const tl = S.timeline; tl.fps = X().fps;
      tl.clips = tl.clips.filter((c) => c.track !== 'V1' && c.track !== 'A1');
      for (const c of res.clips) tl.clips.push(c);
      TL.addClip(tl, { kind: 'audio', track: 'A1', mediaId: music.id, src: music.path, name: music.name, srcIn: 0, srcDur: an.duration, start: 0, dur: an.duration });
      S.selected = null; S.playhead = 0; S.commit(); S.emit('music');
      S.requestProxiesFor(res.clips);
      TLUI.fit();
      $('auto-log').textContent = `${variation ? 'New variation' : 'Auto edit'} (seed ${S.settings.seed}): ${res.stats.clips} clips — ${res.stats.moving} moving, ${res.stats.parked} parked — built in ${Math.round(performance.now() - t0)} ms. Music analysis was not repeated.`;
      Player.seek(0);
    } catch (e) { S.toast('Auto edit failed: ' + e.message, true); }
    finally { S.busy(null); }
  }

  function regenerate(id) {
    id = id || S.selected || (() => { const v = TLC.visibleAt(S.timeline, S.playhead); return v && v.clip.id; })();
    const c = id && TL.getClip(S.timeline, id);
    if (!c || c.kind !== 'video') return S.toast('Select a video clip (or park the playhead on one) first.', true);
    const nc = AE.regenerateClip(S.timeline.clips.filter((x) => x.kind === 'video'), c.id, S.pools(), { seed: rndSeed(), fps: S.timeline.fps });
    if (!nc) return S.toast('No other footage is available for this clip.', true);
    Object.assign(c, nc); S.selected = c.id; S.commit(); S.requestProxiesFor([c]);
    S.toast('Clip regenerated — only this cut will be re-encoded on export.');
  }

  // ---------- timeline tools ----------
  const sel = () => S.selected && TL.getClip(S.timeline, S.selected);
  const need = () => { const c = sel(); if (!c) S.toast('Select a clip first.', true); return c; };
  const T = {
    split() {
      const c = need(); if (!c) return;
      const r = TL.splitClip(S.timeline, c.id, S.playhead);
      if (!r) return S.toast('Place the playhead inside the clip (at least 1 frame from its edges).', true);
      S.selected = r.id; S.commit();
    },
    trimIn() { const c = need(); if (c && TL.trimClip(S.timeline, c.id, 'start', S.playhead)) S.commit(); },
    trimOut() { const c = need(); if (c && TL.trimClip(S.timeline, c.id, 'end', S.playhead)) S.commit(); },
    del() { const c = need(); if (!c) return; TL.deleteClip(S.timeline, c.id); S.selected = null; S.commit(); },
    ripple() { const c = need(); if (!c) return; TL.rippleDelete(S.timeline, c.id); S.selected = null; S.commit(); },
    dup() { const c = need(); if (!c) return; const d = TL.duplicateClip(S.timeline, c.id); if (d) { S.selected = d.id; S.commit(); } else S.toast('No room to duplicate.', true); },
    replace() {
      const c = need(); if (!c) return;
      const m = S.libSel && S.byId[S.libSel];
      if (!m || (c.kind === 'video') !== (m.kind !== 'music')) return S.toast('Select a matching item in the Media Library first, then press Replace.', true);
      if (!TL.replaceClip(S.timeline, c.id, m)) return;
      if (m.kind !== 'music') c.category = m.kind; S.commit(); S.requestProxiesFor([c]);
    },
    crop() { if (!need()) return; showPane('clip'); $('cr-x').focus(); },
  };
  App.tools = T;
  const wire = (id, fn) => { $(id).onclick = fn; };
  wire('t-split', T.split); wire('t-trimin', T.trimIn); wire('t-trimout', T.trimOut); wire('t-del', T.del);
  wire('t-ripple', T.ripple); wire('t-dup', T.dup); wire('t-replace', T.replace); wire('t-crop', T.crop);
  $('t-snap').onclick = () => { S.snap = !S.snap; $('t-snap').classList.toggle('active', S.snap); };
  $('c-regen').onclick = () => regenerate(); $('c-replace').onclick = T.replace;
  wire('b-auto', () => autoEdit(false)); wire('b-var', () => autoEdit(true)); wire('b-regen', () => regenerate());
  wire('b-fast', () => { X().mode = 'fast'; $('x-mode').value = 'fast'; window.runExport(); });
  wire('b-undo', () => { S.undo(); }); wire('b-redo', () => { S.redo(); });

  // ---------- shortcuts ----------
  document.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
    if (e.code === 'Space') { e.preventDefault(); Player.toggle(); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); Player.step(e.shiftKey ? -S.timeline.fps : -1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); Player.step(e.shiftKey ? S.timeline.fps : 1); }
    else if (e.key === 's' && !e.metaKey && !e.ctrlKey) T.split();
    else if (e.key === '[') T.trimIn(); else if (e.key === ']') T.trimOut();
    else if ((e.key === 'Backspace' || e.key === 'Delete') && e.shiftKey) T.ripple();
    else if (e.key === 'Backspace' || e.key === 'Delete') T.del();
    else if ((e.metaKey || e.ctrlKey) && e.key === 'd') { e.preventDefault(); T.dup(); }
    else if (e.key === 'Home') Player.seek(0);
    else if (e.key === 'End') Player.seek(S.duration());
  });

  // ---------- projects ----------
  function snapshot() {
    return { name: S.name, media: S.media, flags: S.flags, musicId: S.musicId, settings: S.settings, seed: S.settings.seed, timeline: S.timeline };
  }
  async function save(as) {
    const text = window.ProjectIO.serialize(snapshot());
    const p = await window.ams.saveProject(text, as ? null : S.projectPath, S.name);
    if (p) { S.projectPath = p; S.dirty = false; S.toast('Project saved.'); }
  }
  function reset() {
    S.media = { moving: [], parked: [], music: [] }; S.byId = {}; S.flags = {}; S.thumbs = {}; S.proxies = {}; S.analysis = {}; S.wf = {};
    S.musicId = null; S.libSel = null; S.selected = null; S.playhead = 0; S.projectPath = null; S.name = 'Untitled'; $('projname').value = S.name;
    S.history = new TL.History(100); S.timeline = TL.create(X().fps); S.history.reset(S.timeline); S.dirty = false;
    S.emit('library'); S.emit('timeline'); S.emit('music');
  }
  async function open() {
    const r = await window.ams.openProject(); if (!r) return;
    if (r.error) return S.toast(r.error, true);
    const d = r.data; reset();
    S.name = d.name; $('projname').value = d.name; S.projectPath = r.path; S.flags = d.flags; S.musicId = d.musicId;
    Object.assign(S.settings, d.settings); Object.assign(S.settings.export, d.settings.export || {});
    for (const k of ['moving', 'parked', 'music']) { S.addMedia(d.media[k], k); window.ams.requestThumbs(d.media[k]); }
    S.history = new TL.History(100); S.timeline = d.timeline; S.history.reset(S.timeline);
    window.syncAutoPane(); window.syncExportPane(); S.emit('timeline'); S.emit('music'); TLUI.fit();
    S.requestProxiesFor(S.timeline.clips);
    for (const m of S.media.music) if (!m.missing) S.ensureAnalysis(m).catch(() => {});
    if (d.missing) S.toast(`${d.missing} media file(s) are missing on disk (marked ⚠).`, true);
    S.dirty = false;
  }
  wire('b-open', open); wire('b-save', () => save(false));
  $('projname').onchange = (e) => { S.name = e.target.value || 'Untitled'; S.dirty = true; };
  window.ams.on('menu', async (a) => {
    if (a === 'new') { if (!S.dirty || confirm('Discard unsaved changes?')) reset(); }
    else if (a === 'open') open(); else if (a === 'save') save(false); else if (a === 'saveAs') save(true);
    else if (a === 'undo') S.undo(); else if (a === 'redo') S.redo(); else if (a === 'export') window.runExport();
    else if (a === 'clearCache') { await window.ams.clearCache(); S.toast('Cache cleared.'); }
  });
  window.addEventListener('beforeunload', () => { window.ams.cancelExport(); });

  // ---------- self test (used by the headless smoke test) ----------
  App.selfTest = async () => {
    const out = { ok: true, checks: [] };
    const chk = (n, v) => { out.checks.push([n, !!v]); if (!v) out.ok = false; };
    const saved = { tl: S.timeline, m: S.media, by: S.byId };
    try {
      const mk = (p, n, d) => Array.from({ length: n }, (_, i) => ({ id: p + i, path: `/fake/${p}${i}.mp4`, name: `${p}${i}.mp4`, duration: d, width: 1920, height: 1080, kind: p === 'm' ? 'moving' : 'parked' }));
      S.media = { moving: mk('m', 4, 30), parked: mk('p', 2, 20), music: [] }; S.byId = {};
      for (const k of ['moving', 'parked']) for (const it of S.media[k]) S.byId[it.id] = it;
      const beats = []; for (let t = 0.25; t < 40; t += 0.5) beats.push(+t.toFixed(3));
      const an = { duration: 40, bpm: 120, beatPeriod: 0.5, beats, downbeatPhase: 0, bars: beats.filter((_, i) => i % 4 === 0), energyStep: 0.25,
        energy: Array.from({ length: 160 }, (_, i) => (i > 60 && i < 100 ? 0.2 : 0.9)), breakdowns: [{ start: 15, end: 25 }], drops: [{ time: 25, strength: 1 }] };
      S.timeline = TL.create(30); S.history = new TL.History(100); S.history.reset(S.timeline);
      const res = AE.generate({ analysis: an, pools: S.pools(), options: { seed: 4, fps: 30 } });
      S.timeline.clips = res.clips.slice(); const n0 = res.clips.length; S.commit();
      chk('clips generated', res.clips.length > 10);
      chk('timeline DOM rendered', document.querySelectorAll('#lanes .clip').length === res.clips.length);
      chk('overlap-free', TL.validate(S.timeline).length === 0);
      Player.seek(5); chk('playhead moved', Math.abs(S.playhead - 5) < 1e-6);
      S.selected = res.clips[0].id; Player.seek(res.clips[0].start + res.clips[0].dur / 2); T.split();
            chk('split works', S.timeline.clips.length === n0 + 1);
      S.undo(); chk('undo works', S.timeline.clips.length === n0);
      S.redo(); chk('redo works', S.timeline.clips.length === n0 + 1);
    } catch (e) { out.ok = false; out.error = String(e && e.stack || e); }
    S.timeline = saved.tl; S.media = saved.m; S.byId = saved.by; S.history = new TL.History(100); S.history.reset(S.timeline); S.emit('timeline'); S.emit('library');
    return out;
  };

  // ---------- init ----------
  window.ams.config().then(({ config, presets }) => { S.config = config; S.presets = presets; S.history = new TL.History(config.undoLimit || 100); S.history.reset(S.timeline); });
  S.timeline.fps = X().fps;
  S.emit('timeline');
  S.emit('aspect');
})();
