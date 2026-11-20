'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { analyze } = require('../src/audio/analyzer');
const { synthTrack } = require('./helpers/synth');

test('detects BPM, beats, bars, kicks, breakdown and drop on a synthetic track', () => {
  const { samples, sr } = synthTrack({ bpm: 120, seconds: 48, offset: 0.2 });
  const a = analyze(samples, sr);
  assert.ok(Math.abs(a.bpm - 120) < 1.5, 'bpm ' + a.bpm);
  // beat grid aligned with true beats (0.2 + k*0.5)
  const errs = a.beats.slice(4, 80).map((b) => { const k = Math.round((b - 0.2) / 0.5); return Math.abs(b - (0.2 + k * 0.5)); });
  errs.sort((x, y) => x - y);
  assert.ok(errs[Math.floor(errs.length / 2)] < 0.04, 'median beat error ' + errs[Math.floor(errs.length / 2)]);
  assert.ok(a.kicks.length > 40, 'kicks ' + a.kicks.length);
  assert.ok(a.snares.length > 10, 'snares ' + a.snares.length);
  assert.ok(a.bars.length >= 20 && a.bars.length <= 26, 'bars ' + a.bars.length);
  assert.ok(a.breakdowns.length >= 1, 'breakdown found');
  const bd = a.breakdowns[0];
  assert.ok(bd.start > 12 && bd.start < 20 && bd.end > 21 && bd.end < 28, JSON.stringify(bd));
  assert.ok(a.drops.some((d) => Math.abs(d.time - 24) < 1.2), 'drop near 24s ' + JSON.stringify(a.drops));
  assert.ok(a.energy.length === Math.ceil(48 / 0.25));
  assert.ok(Buffer.from(a.waveform, 'base64').length >= 4700);
});
