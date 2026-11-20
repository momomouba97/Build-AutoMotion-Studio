'use strict';
// Low-resolution, short-GOP proxy files for smooth preview and scrubbing. Cached, built in background.
const fs = require('fs');
const { hash } = require('../cache/cache');
const ff = require('./ffmpeg');

class ProxyService {
  constructor(cache, config) {
    this.cache = cache;
    this.config = config;
    this.queue = [];
    this.busy = 0;
    this.pending = new Set();
  }

  proxyPath(item) {
    return this.cache.file('proxy', hash('proxy-v1', item.sig, this.config.proxyHeight), '.mp4');
  }

  async existing(item) {
    try { const st = await fs.promises.stat(this.proxyPath(item)); return st.size > 0 ? this.proxyPath(item) : null; }
    catch (_) { return null; }
  }

  async request(items, onReady) {
    for (const it of items) {
      if (it.kind === 'music' || this.pending.has(it.id)) continue;
      const have = await this.existing(it);
      if (have) { onReady(it.id, have); continue; }
      this.pending.add(it.id);
      this.queue.push({ it, onReady });
    }
    this._pump();
  }

  _pump() {
    while (this.busy < this.config.proxyConcurrency && this.queue.length) {
      const { it, onReady } = this.queue.shift();
      this.busy++;
      this._build(it)
        .then((p) => { if (p) onReady(it.id, p); })
        .catch(() => {})
        .finally(() => { this.busy--; this.pending.delete(it.id); this._pump(); });
    }
  }

  async _build(it) {
    const out = this.proxyPath(it);
    const tmp = out + '.part.mp4';
    const h = this.config.proxyHeight;
    const args = ['-v', 'error', '-nostdin', '-y', '-i', it.path, '-an', '-vf', `scale=-2:${h},fps=30,format=yuv420p`,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28', '-g', '15', '-threads', '2', '-movflags', '+faststart', tmp];
    let r = await ff.ffmpeg(args);
    if (r.code !== 0) {
      // libx264 missing: try VideoToolbox
      const a2 = args.slice();
      a2.splice(a2.indexOf('libx264'), 1, 'h264_videotoolbox');
      r = await ff.ffmpeg(a2.filter((x) => !['-preset', 'ultrafast', '-crf', '28'].includes(x)));
    }
    if (r.code !== 0) return null;
    await fs.promises.rename(tmp, out);
    return out;
  }
}

module.exports = { ProxyService };
