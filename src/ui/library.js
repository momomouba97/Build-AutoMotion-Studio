'use strict';
// Media Library panel: tabs, import, thumbnails, durations, favorites / excluded, source preview.
(function () {
  const list = $('lib-list');
  const KIND_LABEL = { moving: 'moving cars', parked: 'parked cars', music: 'music' };

  function visible() {
    const f = $('lib-filter').value;
    return S.media[S.libTab].filter((m) => (f === 'all' ? true : f === 'fav' ? S.flags[m.id] === 'fav' : S.flags[m.id] === 'excl'));
  }

  function render() {
    list.className = S.libTab === 'music' ? 'music' : '';
    list.textContent = '';
    const items = visible();
    if (!items.length) {
      const e = document.createElement('div'); e.className = 'empty';
      e.textContent = S.media[S.libTab].length ? 'Nothing matches this filter.' : `No ${KIND_LABEL[S.libTab]} yet.\nUse “Import…” to add a folder or files.`;
      e.style.whiteSpace = 'pre-line'; list.appendChild(e); return;
    }
    for (const m of items) list.appendChild(card(m));
  }

  function card(m) {
    const d = document.createElement('div');
    d.className = 'card' + (S.libTab === 'music' ? ' music' : '') + (S.libSel === m.id ? ' sel' : '') + (S.isExcluded(m.id) ? ' excl' : '') + (S.musicId === m.id ? ' cur' : '');
    d.draggable = !m.missing; d.dataset.id = m.id;
    if (S.libTab !== 'music') {
      const th = document.createElement('div'); th.className = 'th';
      if (S.thumbs[m.id]) th.style.backgroundImage = `url("${S.fileUrl(S.thumbs[m.id])}")`;
      d.appendChild(th);
      const du = document.createElement('span'); du.className = 'du'; du.textContent = S.fmt(m.duration); d.appendChild(du);
    }
    const meta = document.createElement('div'); meta.className = 'meta';
    if (S.libTab === 'music') meta.style.flex = '1';
    const nm = document.createElement('span'); nm.className = 'nm';
    nm.textContent = (m.missing ? '⚠ ' : '') + m.name + (S.libTab === 'music' ? '  ·  ' + S.fmt(m.duration) + (S.analysis[m.id] ? '  ·  ' + S.analysis[m.id].bpm + ' BPM' : '') : '');
    nm.title = m.path;
    const fav = btn('★', 'ic' + (S.flags[m.id] === 'fav' ? ' on' : ''), 'Favorite', () => toggle(m.id, 'fav'));
    const ex = btn('✕', 'ic x' + (S.flags[m.id] === 'excl' ? ' on' : ''), 'Exclude from auto edit', () => toggle(m.id, 'excl'));
    meta.append(nm, fav, ex); d.appendChild(meta);
    d.addEventListener('click', () => { S.libSel = m.id; if (S.libTab === 'music') { S.musicId = m.id; S.emit('music'); } render(); });
    d.addEventListener('dblclick', () => preview(m));
    d.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/ams-media', m.id); e.dataTransfer.effectAllowed = 'copy'; });
    return d;
  }
  function btn(txt, cls, title, fn) {
    const b = document.createElement('button'); b.className = cls; b.textContent = txt; b.title = title;
    b.addEventListener('click', (e) => { e.stopPropagation(); fn(); }); return b;
  }
  function toggle(id, flag) {
    if (S.flags[id] === flag) delete S.flags[id]; else S.flags[id] = flag;
    S.dirty = true; render();
  }

  function preview(m) {
    if (m.missing) return S.toast('File is missing on disk.', true);
    const body = $('modal-body'); body.textContent = '';
    const el = document.createElement(m.kind === 'music' ? 'audio' : 'video');
    el.controls = true; el.autoplay = true; el.src = S.fileUrl(m.path);
    body.appendChild(el);
    $('modal').style.display = 'flex';
  }
  $('modal-close').onclick = () => { $('modal').style.display = 'none'; $('modal-body').textContent = ''; };

  async function importCurrent() {
    const kind = S.libTab;
    S.busy('Scanning and probing files…');
    const off = window.ams.on('scan:progress', (p) => S.busy(`Probing ${p.done}/${p.total}…`));
    try {
      const items = await window.ams.importMedia(kind);
      off();
      if (!items.length) { S.busy(null); return; }
      const before = S.media[kind].length;
      S.addMedia(items, kind);
      const fresh = items.filter((i) => S.byId[i.id] === i);
      window.ams.requestThumbs(items);
      if (kind === 'music') { if (!S.musicId) { S.musicId = items[0].id; S.emit('music'); } }
      S.toast(`Imported ${S.media[kind].length - before} new ${KIND_LABEL[kind]} (${items.length} found).`);
      void fresh;
    } catch (e) { S.toast('Import failed: ' + e.message, true); }
    finally { off(); S.busy(null); }
  }

  $('b-import').onclick = importCurrent;
  $('lib-filter').onchange = render;
  $('lib-tabs').onclick = (e) => {
    const b = e.target.closest('button'); if (!b) return;
    S.libTab = b.dataset.k;
    for (const x of $('lib-tabs').children) x.classList.toggle('on', x === b);
    render();
  };
  S.on('library', render);
  S.on('music', render);
  S.on('analysis', render);
  let rq = false;
  window.ams.on('thumb:ready', ({ id, path }) => { S.thumbs[id] = path; if (!rq) { rq = true; setTimeout(() => { rq = false; render(); }, 250); } });
  render();
})();
