'use strict';
// Folder scanning, probing (cached), thumbnails (cached) — all non-blocking with bounded concurrency.
const fs = require('fs');
const path = require('path');
const { hash, fileSignature } = require('../cache/cache');
const ff = require('./ffmpeg');

async function pool(items, limit, worker) {
  const results = new Array(items.length);
  let i = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      results[k] = await worker(items[k], k);
    }
  });
  await Promise.all(runners);
  return results;
}

async function walk(target, exts, out) {
  let st;
  try { st = await fs.promises.stat(target); } catch (_) { return; }
  if (st.isFile()) {
    const base = path.basename(target);
    if (!base.startsWith('.') && exts.has(path.extname(base).slice(1).toLowerCase())) out.push(target);
    return;
  }
  if (!st.isDirectory()) return;
  let entries = [];
  try { entries = await fs.promises.readdir(target, { withFileTypes: true }); } catch (_) { return; }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    await walk(path.join(target, e.name), exts, out);
  }
}

class Scanner {
  constructor(cache, config) {
    this.cache = cache;
    this.config = config;
    this.thumbQueue = [];
    this.thumbBusy = 0;
  }

  async scan(targets, kind, onProgress) {
    const exts = new Set((kind === 'music' ? this.config.audioExtensions : this.config.videoExtensions));
    const files = [];
    for (const t of targets) await walk(t, exts, files);
    let done = 0;
    const items = await pool(files, this.config.probeConcurrency, async (file) => {
      let item = null;
      try { item = await this.describe(file, kind); } catch (_) { item = null; }
      done++;
      if (onProgress) onProgress({ done, total: files.length });
      return item;
    });
    return items.filter(Boolean);
  }

  async describe(file, kind) {
    const sig = await fileSignature(file);
    const key = hash('probe-v1', sig);
    let info = await this.cache.readJSON('probe', key);
    if (!info) {
      info = await ff.probe(file);
      await this.cache.writeJSON('probe', key, info);
    }
    if (kind === 'music' ? !info.hasAudio : !info.hasVideo) return null;
    if (!(info.duration > 0.2)) return null;
    return {
      id: hash('media', path.resolve(file)).slice(0, 16),
      path: path.resolve(file),
      name: path.basename(file),
      kind,
      sig: hash(sig),
      ...info,
    };
  }

  thumbPath(item) {
    return this.cache.file('thumbs', hash('thumb-v1', item.sig, this.config.thumbnailWidth), '.jpg');
  }

  // Queue thumbnails; callback(item.id, path) as each one is ready.
  requestThumbs(items, onReady) {
    for (const it of items) {
      if (it.kind === 'music') continue;
      this.thumbQueue.push({ it, onReady });
    }
    this._pump();
  }

  _pump() {
    while (this.thumbBusy < this.config.thumbConcurrency && this.thumbQueue.length) {
      const { it, onReady } = this.thumbQueue.shift();
      this.thumbBusy++;
      this._makeThumb(it).then((p) => { if (p) onReady(it.id, p); }).catch(() => {}).finally(() => { this.thumbBusy--; this._pump(); });
    }
  }

  async _makeThumb(it) {
    const out = this.thumbPath(it);
    try { const st = await fs.promises.stat(out); if (st.size > 0) return out; } catch (_) { /* build */ }
    const at = Math.min(it.duration * 0.3, 8);
    const tmp = out + '.part.jpg';
    const r = await ff.ffmpeg(['-v', 'error', '-nostdin', '-y', '-ss', at.toFixed(2), '-i', it.path, '-frames:v', '1',
      '-vf', `scale=${this.config.thumbnailWidth}:-2`, '-q:v', '5', tmp]);
    if (r.code !== 0) return null;
    await fs.promises.rename(tmp, out);
    return out;
  }
}

module.exports = { Scanner, pool };
