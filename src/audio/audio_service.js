'use strict';
// Decodes music, analyses it in a worker thread, caches the result (never re-analysed unless the file changes).
const path = require('path');
const { Worker } = require('worker_threads');
const { hash, fileSignature } = require('../cache/cache');
const ff = require('../media/ffmpeg');

class AudioService {
  constructor(cache, config) {
    this.cache = cache;
    this.config = config;
    this.inflight = new Map();
  }

  async analyze(file, onStage) {
    const sig = await fileSignature(file);
    const key = hash('analysis-v1', sig, this.config.analysisSampleRate);
    const cached = await this.cache.readJSON('analysis', key);
    if (cached) return { analysis: cached, fromCache: true };
    if (this.inflight.has(key)) return this.inflight.get(key);
    const p = (async () => {
      if (onStage) onStage('decoding');
      const samples = await ff.decodeAudio(file, this.config.analysisSampleRate);
      if (samples.length < 4096) throw new Error('Audio too short to analyse');
      if (onStage) onStage('analyzing');
      const analysis = await new Promise((resolve, reject) => {
        const w = new Worker(path.join(__dirname, 'analyzer_worker.js'), {
          workerData: { buffer: samples.buffer, sampleRate: this.config.analysisSampleRate },
          transferList: [samples.buffer],
        });
        w.once('message', (m) => (m.ok ? resolve(m.result) : reject(new Error(m.error))));
        w.once('error', reject);
      });
      await this.cache.writeJSON('analysis', key, analysis);
      return { analysis, fromCache: false };
    })().finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }
}

module.exports = { AudioService };
