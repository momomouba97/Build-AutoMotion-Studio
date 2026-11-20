'use strict';
// Synthetic music generator: kick on every beat, snare on beats 2 & 4, a breakdown (no kick/bass) in the middle.
function synthTrack({ bpm = 120, seconds = 48, sr = 22050, offset = 0.2, breakdown = [16, 24] } = {}) {
  const out = new Float32Array(Math.floor(seconds * sr));
  const period = 60 / bpm;
  let rng = 12345;
  const rnd = () => { rng = (rng * 1664525 + 1013904223) >>> 0; return rng / 4294967296 - 0.5; };
  const inBreak = (t) => t >= breakdown[0] && t < breakdown[1];
  for (let i = 0, t0 = offset; t0 < seconds; i++, t0 += period) {
    if (inBreak(t0)) continue;
    const s0 = Math.floor(t0 * sr);
    for (let n = 0; n < sr * 0.25 && s0 + n < out.length; n++) {
      const t = n / sr;
      const f = 50 + 90 * Math.exp(-t * 35);
      out[s0 + n] += 0.9 * Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 12);
    }
    if (i % 2 === 1) {
      for (let n = 0; n < sr * 0.12 && s0 + n < out.length; n++) out[s0 + n] += 0.45 * rnd() * Math.exp(-(n / sr) * 30);
    }
  }
  // quiet pad so breakdown is not digital silence
  for (let n = 0; n < out.length; n++) out[n] += 0.03 * Math.sin(2 * Math.PI * 220 * n / sr);
  return { samples: out, sr, bpm, offset };
}
module.exports = { synthTrack };

function writeWav(file, samples, sr) {
  const fs = require('fs');
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + samples.length * 2, 4); buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sr, 24);
  buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36);
  buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(samples[i] * 32767 * 0.8))), 44 + i * 2);
  fs.writeFileSync(file, buf);
}
module.exports.writeWav = writeWav;
