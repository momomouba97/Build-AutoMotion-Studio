'use strict';
// Content-addressed disk cache (probe results, thumbnails, proxies, audio analysis, render segments).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function hash(...parts) {
  return crypto.createHash('sha1').update(parts.map(String).join('|')).digest('hex');
}

async function fileSignature(file) {
  const st = await fs.promises.stat(file);
  return `${path.resolve(file)}|${st.size}|${Math.round(st.mtimeMs)}`;
}

class Cache {
  constructor(root) {
    this.root = root;
  }
  dir(ns) {
    const d = path.join(this.root, ns);
    fs.mkdirSync(d, { recursive: true });
    return d;
  }
  file(ns, key, ext) {
    return path.join(this.dir(ns), key + (ext || ''));
  }
  async exists(ns, key, ext) {
    try {
      const st = await fs.promises.stat(this.file(ns, key, ext));
      return st.size > 0;
    } catch (_) { return false; }
  }
  async readJSON(ns, key) {
    try { return JSON.parse(await fs.promises.readFile(this.file(ns, key, '.json'), 'utf8')); }
    catch (_) { return null; }
  }
  async writeJSON(ns, key, obj) {
    const f = this.file(ns, key, '.json');
    const tmp = f + '.part';
    await fs.promises.writeFile(tmp, JSON.stringify(obj));
    await fs.promises.rename(tmp, f);
  }
  // Delete least-recently-used files in a namespace until under maxBytes.
  async prune(ns, maxBytes) {
    const d = this.dir(ns);
    const entries = [];
    let total = 0;
    for (const name of await fs.promises.readdir(d)) {
      try {
        const p = path.join(d, name);
        const st = await fs.promises.stat(p);
        if (!st.isFile()) continue;
        total += st.size;
        entries.push({ p, size: st.size, t: Math.max(st.atimeMs, st.mtimeMs) });
      } catch (_) { /* ignore */ }
    }
    if (total <= maxBytes) return 0;
    entries.sort((a, b) => a.t - b.t);
    let removed = 0;
    for (const e of entries) {
      if (total <= maxBytes) break;
      try { await fs.promises.unlink(e.p); total -= e.size; removed++; } catch (_) { /* ignore */ }
    }
    return removed;
  }
  async clear() {
    await fs.promises.rm(this.root, { recursive: true, force: true });
    fs.mkdirSync(this.root, { recursive: true });
  }
}

module.exports = { Cache, hash, fileSignature };
