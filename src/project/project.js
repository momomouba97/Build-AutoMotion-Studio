'use strict';
// Project file (.amsproj) serialisation / validation. Pure; file I/O is done by the caller.
const VERSION = 1;

function serialize(state) {
  return JSON.stringify({
    format: 'automotion-studio-project',
    version: VERSION,
    name: state.name || 'Untitled',
    savedAt: new Date().toISOString(),
    media: state.media,
    flags: state.flags || {},
    musicId: state.musicId || null,
    settings: state.settings || {},
    seed: state.seed || null,
    timeline: state.timeline,
  }, null, 1);
}

function deserialize(text, fileExists) {
  let o;
  try { o = JSON.parse(text); } catch (_) { throw new Error('Project file is not valid JSON.'); }
  if (!o || o.format !== 'automotion-studio-project') throw new Error('Not an AutoMotion Studio project.');
  if (o.version > VERSION) throw new Error('Project was saved by a newer version of the app.');
  const media = { moving: [], parked: [], music: [] };
  let missing = 0;
  for (const k of Object.keys(media)) {
    for (const it of (o.media && o.media[k]) || []) {
      const ok = !fileExists || fileExists(it.path);
      if (!ok) missing++;
      media[k].push(Object.assign({}, it, { missing: !ok }));
    }
  }
  const tl = o.timeline && Array.isArray(o.timeline.clips) && Array.isArray(o.timeline.tracks) ? o.timeline : null;
  if (!tl) throw new Error('Project has no valid timeline.');
  return { name: o.name || 'Untitled', media, flags: o.flags || {}, musicId: o.musicId || null, settings: o.settings || {}, seed: o.seed || null, timeline: tl, missing };
}

module.exports = { serialize, deserialize, VERSION };
