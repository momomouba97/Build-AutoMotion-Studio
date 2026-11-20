'use strict';
const { parentPort, workerData } = require('worker_threads');
const { analyze } = require('./analyzer');
try {
  const samples = new Float32Array(workerData.buffer);
  parentPort.postMessage({ ok: true, result: analyze(samples, workerData.sampleRate) });
} catch (e) {
  parentPort.postMessage({ ok: false, error: String(e && e.stack || e) });
}
