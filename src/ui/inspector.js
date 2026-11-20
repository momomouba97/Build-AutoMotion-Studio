'use strict';
// Right panel: Auto Edit settings, Clip properties (incl. crop), Export panel with real progress.
(function () {
  const X = S.settings.export;

  // ---- tabs ----
  const panes = { auto: $('p-auto'), clip: $('p-clip'), export: $('p-export') };
  window.showPane = (k) => {
    for (const b of $('itabs').children) b.classList.toggle('on', b.dataset.p === k);
    for (const [n, el] of Object.entries(panes)) el.classList.toggle('on', n === k);
  };
  $('itabs').onclick = (e) => { const b = e.target.closest('button'); if (b) showPane(b.dataset.p); };

  // ---- auto edit pane ----
  function fillMusic() {
    const sel = $('s-music'); sel.textContent = '';
    for (const m of S.media.music) { const o = document.createElement('option'); o.value = m.id; o.textContent = m.name; sel.appendChild(o); }
    if (S.musicId) sel.value = S.musicId;
    if (!S.media.music.length) { const o = document.createElement('option'); o.textContent = '(import music first)'; sel.appendChild(o); }
  }
  function showAnalysis() {
    const a = S.analysis[S.musicId];
    $('an-bpm').textContent = a ? a.bpm + (a.bpmConfidence < 0.25 ? ' (low confidence)' : '') : '–';
    $('an-bars').textContent = a ? a.bars.length : '–';
    $('an-ks').textContent = a ? a.kicks.length + ' / ' + a.snares.length : '–';
    $('an-drops').textContent = a ? a.drops.length : '–';
    $('an-bd').textContent = a ? a.breakdowns.length : '–';
    $('an-clips').textContent = S.timeline.clips.filter((c) => c.track === 'V1').length;
  }
  $('s-music').onchange = (e) => { S.musicId = e.target.value; S.emit('music'); S.ensureAnalysis(S.byId[S.musicId]).catch(() => {}); };
  $('s-cut').onchange = (e) => { S.settings.cutMode = e.target.value; };
  $('s-parked').oninput = (e) => { S.settings.parkedShare = +e.target.value; $('s-parked-v').textContent = e.target.value + '%'; };
  $('s-seed').onchange = (e) => { S.settings.seed = Math.max(1, Math.min(999999, parseInt(e.target.value, 10) || 1)); };
  S.on('library', fillMusic); S.on('music', () => { fillMusic(); showAnalysis(); });
  S.on('analysis', showAnalysis); S.on('timeline', showAnalysis);
  window.syncAutoPane = () => {
    $('s-cut').value = S.settings.cutMode; $('s-parked').value = S.settings.parkedShare; $('s-parked-v').textContent = S.settings.parkedShare + '%';
    $('s-seed').value = S.settings.seed || ''; fillMusic(); showAnalysis();
  };

  // ---- clip pane ----
  const F = { start: $('c-start'), dur: $('c-dur'), in: $('c-in'), speed: $('c-speed'), gain: $('c-gain') };
  const CR = { x: $('cr-x'), y: $('cr-y'), w: $('cr-w'), h: $('cr-h') };
  function showClip() {
    const c = S.selected && TL.getClip(S.timeline, S.selected);
    $('clip-none').style.display = c ? 'none' : 'block'; $('clip-form').style.display = c ? 'block' : 'none';
    if (!c) return;
    $('c-name').textContent = c.name || c.src; $('c-track').textContent = c.track + ' · ' + c.kind + (c.category ? ' · ' + c.category : '');
    F.start.value = c.start.toFixed(3); F.dur.value = c.dur.toFixed(3); F.in.value = c.srcIn.toFixed(3); F.speed.value = c.speed || 1; F.gain.value = c.gain === undefined ? 1 : c.gain;
    $('c-video-only').style.display = c.kind === 'video' ? 'block' : 'none';
    $('c-gain-row').style.display = c.kind === 'audio' ? 'flex' : 'none';
    const cr = c.crop || { x: 0, y: 0, w: 1, h: 1 };
    CR.x.value = Math.round(cr.x * 100); CR.y.value = Math.round(cr.y * 100); CR.w.value = Math.round(cr.w * 100); CR.h.value = Math.round(cr.h * 100);
  }
  S.on('selection', showClip); S.on('timeline', showClip);

  $('c-apply').onclick = () => {
    const c = TL.getClip(S.timeline, S.selected); if (!c) return;
    const snap = JSON.stringify(c);
    const fps = S.timeline.fps;
    const nd = Math.max(1 / fps, parseFloat(F.dur.value) || c.dur);
    c.speed = Math.min(4, Math.max(0.25, parseFloat(F.speed.value) || 1));
    c.srcIn = Math.max(0, parseFloat(F.in.value) || 0);
    if (c.kind === 'audio') c.gain = Math.max(0, Math.min(2, parseFloat(F.gain.value)));
    c.dur = TL.q(Math.min(nd, c.srcDur ? Math.max(1 / fps, (c.srcDur - c.srcIn) / c.speed) : nd), fps);
    const ok = TL.moveClip(S.timeline, c.id, parseFloat(F.start.value) || 0);
    if (!ok) { Object.assign(c, JSON.parse(snap)); S.toast('Those values do not fit on the track.', true); showClip(); return; }
    S.commit();
  };
  function applyCrop(rect) { const c = TL.getClip(S.timeline, S.selected); if (!c) return; TL.setCrop(S.timeline, c.id, rect); S.commit(); }
  $('cr-apply').onclick = () => applyCrop({ x: CR.x.value / 100, y: CR.y.value / 100, w: CR.w.value / 100, h: CR.h.value / 100 });
  $('cr-reset').onclick = () => applyCrop(null);
  $('cr-center').onclick = () => {
    const c = TL.getClip(S.timeline, S.selected); const m = c && S.mediaOf(c); if (!m) return;
    const w = Math.min(1, (m.height * 9 / 16) / m.width); applyCrop({ x: (1 - w) / 2, y: 0, w, h: 1 });
  };

  // ---- export pane ----
  const bind = (id, key, num) => { const el = $(id); el.value = X[key]; el.onchange = () => { X[key] = num ? Number(el.value) : el.value; if (key === 'aspect') S.emit('aspect'); if (key === 'fps') S.timeline.fps = X.fps; S.dirty = true; }; };
  bind('x-container', 'container'); bind('x-codec', 'codec'); bind('x-res', 'res', true); bind('x-aspect', 'aspect');
  bind('x-fps', 'fps', true); bind('x-mode', 'mode'); bind('x-hw', 'hw'); bind('x-fade', 'fadeOut', true);
  window.syncExportPane = () => { for (const [id, k] of [['x-container', 'container'], ['x-codec', 'codec'], ['x-res', 'res'], ['x-aspect', 'aspect'], ['x-fps', 'fps'], ['x-mode', 'mode'], ['x-hw', 'hw'], ['x-fade', 'fadeOut']]) $(id).value = X[k]; S.timeline.fps = X.fps; S.emit('aspect'); };

  let lastOut = null, t0 = 0, running = false;
  const setBar = (p) => { $('x-bar').style.width = Math.round(p * 100) + '%'; };
  window.ams.on('export:progress', (p) => {
    setBar(p.pct);
    const el = (performance.now() - t0) / 1000;
    const eta = p.pct > 0.03 && p.pct < 1 ? ' · ETA ' + S.fmtShort(el / p.pct - el) : '';
    $('x-status').textContent = p.phase === 'segments' ? `Encoding cuts ${p.done}/${p.total}${p.cached ? ' (+' + p.cached + ' cached)' : ''} · ${p.encoder}${eta}`
      : p.phase === 'mux' ? 'Joining video and mixing audio…' + eta : 'Done';
  });

  window.runExport = async () => {
    if (running) return;
    const dur = S.duration();
    if (!S.timeline.clips.some((c) => c.kind === 'video') || dur <= 0) return S.toast('The timeline is empty. Run AUTO EDIT first.', true);
    Player.pause();
    const outPath = await window.ams.chooseExportPath(S.name || 'AutoMotion', X.container);
    if (!outPath) return;
    running = true; lastOut = null; t0 = performance.now();
    $('x-go').disabled = true; $('x-cancel').disabled = false; $('x-reveal').disabled = true; $('x-log').className = 'log'; $('x-log').textContent = '';
    setBar(0); $('x-status').textContent = 'Starting…'; showPane('export');
    const res = await window.ams.startExport({ timeline: S.timeline, settings: Object.assign({}, X), outPath, totalDur: dur });
    running = false; $('x-go').disabled = false; $('x-cancel').disabled = true;
    if (res.ok) {
      lastOut = res.outPath; $('x-reveal').disabled = false; setBar(1);
      $('x-status').textContent = `Done in ${res.seconds.toFixed(1)} s`;
      $('x-log').textContent = `${res.outPath}\n${(res.size / 1048576).toFixed(1)} MB · ${res.segments} cuts (${res.encoded} encoded, ${res.cached} reused from cache) · ${res.encoder}` + (res.warnings && res.warnings.length ? '\n' + res.warnings.join('\n') : '');
      S.toast('Export finished.');
    } else if (res.cancelled) { setBar(0); $('x-status').textContent = 'Cancelled'; }
    else { $('x-status').textContent = 'Export failed'; $('x-log').className = 'log err'; $('x-log').textContent = res.error; S.toast('Export failed — see the Export panel for details.', true); }
  };
  $('x-go').onclick = () => window.runExport();
  $('x-cancel').onclick = () => window.ams.cancelExport();
  $('x-reveal').onclick = () => lastOut && window.ams.reveal(lastOut);

  window.ams.encoders().then((e) => {
    const ok = (b) => (b ? '✓' : '✗');
    $('x-enc').textContent = `FFmpeg: ${e.version || 'unknown'}\nH.264 VideoToolbox ${ok(e.h264_videotoolbox)}  HEVC VideoToolbox ${ok(e.hevc_videotoolbox)}  x264 ${ok(e.libx264)}  x265 ${ok(e.libx265)}`;
  }).catch(() => {});
  window.syncAutoPane();
})();
