'use strict';
// Music analysis: BPM, beats (DP beat tracker), bars, kicks, snares, bass, energy, drops, breakdowns, waveform.
// Pure DSP, no dependencies; runs in a worker thread.

const N = 1024;
const HOP = 256;

function makeFFT(n) {
  const levels = Math.log2(n);
  const cos = new Float64Array(n / 2), sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) { cos[i] = Math.cos((2 * Math.PI * i) / n); sin[i] = Math.sin((2 * Math.PI * i) / n); }
  const rev = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < levels; b++) r |= ((i >> b) & 1) << (levels - 1 - b);
    rev[i] = r;
  }
  return function fft(re, im) {
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = i, k = 0; j < i + half; j++, k += step) {
          const l = j + half;
          const tre = re[l] * cos[k] + im[l] * sin[k];
          const tim = -re[l] * sin[k] + im[l] * cos[k];
          re[l] = re[j] - tre; im[l] = im[j] - tim;
          re[j] += tre; im[j] += tim;
        }
      }
    }
  };
}

const mean = (a) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return a.length ? s / a.length : 0; };
const std = (a) => { const m = mean(a); let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - m) ** 2; return Math.sqrt(s / Math.max(1, a.length)); };
function percentile(arr, p) {
  if (!arr.length) return 0;
  const s = Array.from(arr).sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))];
}
const round3 = (x) => Math.round(x * 1000) / 1000;

function movingAvg(a, w) {
  const out = new Float64Array(a.length);
  let s = 0;
  const q = [];
  for (let i = 0; i < a.length; i++) {
    s += a[i]; q.push(a[i]);
    if (q.length > w) s -= q.shift();
    out[i] = s / q.length;
  }
  return out;
}

// Subtract a local mean and half-wave rectify, scale to unit std.
function normalizeEnv(env, fps) {
  const w = Math.max(3, Math.round(fps * 0.6));
  const local = movingAvg(env, w * 2 + 1);
  const out = new Float64Array(env.length);
  for (let i = 0; i < env.length; i++) {
    const j = Math.min(env.length - 1, i + w); // centered average (shift by w)
    out[i] = Math.max(0, env[i] - local[j]);
  }
  const s = std(out) || 1;
  for (let i = 0; i < out.length; i++) out[i] /= s;
  return out;
}

function pickPeaks(env, fps, { minGap = 0.09, k = 0.6, minAbs = 0.3 } = {}) {
  const w = Math.max(1, Math.round((minGap * fps) / 2));
  const avgWin = Math.round(fps * 1.0);
  const peaks = [];
  let last = -1e9;
  for (let i = 1; i < env.length - 1; i++) {
    const v = env[i];
    if (v < minAbs || v < env[i - 1] || v < env[i + 1]) continue;
    let isMax = true;
    for (let j = Math.max(0, i - w); j <= Math.min(env.length - 1, i + w); j++) if (env[j] > v) { isMax = false; break; }
    if (!isMax) continue;
    let s = 0, c = 0;
    for (let j = Math.max(0, i - avgWin); j <= Math.min(env.length - 1, i + avgWin); j++) { s += env[j]; c++; }
    if (v < (s / c) * (1 + k)) continue;
    if (i - last < w) continue;
    peaks.push(i); last = i;
  }
  return peaks;
}

function estimateTempo(env, fps) {
  const n = env.length;
  const minLag = Math.floor((fps * 60) / 200), maxLag = Math.ceil((fps * 60) / 60);
  const ac = new Float64Array(maxLag * 4 + 2);
  const m = mean(env);
  for (let lag = minLag; lag < ac.length && lag < n / 2; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += (env[i] - m) * (env[i + lag] - m);
    ac[lag] = s / (n - lag);
  }
  let best = -1, bestScore = -Infinity;
  const scores = new Float64Array(maxLag + 2);
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = (60 * fps) / lag;
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 125) / 0.85) ** 2);
    const sc = (ac[lag] + 0.5 * (ac[lag * 2] || 0) + 0.25 * (ac[lag * 4] || 0)) * prior;
    scores[lag] = sc;
    if (sc > bestScore) { bestScore = sc; best = lag; }
  }
  if (best < 0) return { period: fps * 0.5, bpm: 120, confidence: 0 };
  let lag = best;
  if (best > minLag && best < maxLag) { // parabolic interpolation
    const a = scores[best - 1], b = scores[best], c = scores[best + 1];
    const d = a - 2 * b + c;
    if (d !== 0) lag = best + (0.5 * (a - c)) / d;
  }
  const conf = Math.max(0, Math.min(1, bestScore / ((ac[minLag] || 0) + 1e-9 + Math.abs(bestScore))));
  return { period: lag, bpm: (60 * fps) / lag, confidence: conf };
}

// Ellis (2007) dynamic-programming beat tracker.
function trackBeats(env, period, tightness = 300) {
  const n = env.length;
  const cum = new Float64Array(n), back = new Int32Array(n).fill(-1);
  for (let t = 0; t < n; t++) {
    const lo = Math.max(0, Math.floor(t - 2 * period)), hi = Math.round(t - period / 2);
    let best = -Infinity, bi = -1;
    for (let p = lo; p <= hi; p++) {
      const sc = cum[p] - tightness * Math.log((t - p) / period) ** 2;
      if (sc > best) { best = sc; bi = p; }
    }
    if (bi < 0) { cum[t] = env[t]; } else { cum[t] = env[t] + best; back[t] = bi; }
  }
  let end = n - 1, bv = -Infinity;
  for (let t = Math.max(0, n - Math.round(period)); t < n; t++) if (cum[t] > bv) { bv = cum[t]; end = t; }
  const idx = [];
  for (let t = end; t >= 0; t = back[t]) { idx.push(t); if (back[t] < 0) break; }
  return idx.reverse();
}

function analyze(samples, sr, opts = {}) {
  const duration = samples.length / sr;
  const fps = sr / HOP;
  const frames = Math.max(0, Math.floor((samples.length - N) / HOP) + 1);
  const fft = makeFFT(N);
  const hann = new Float64Array(N);
  for (let i = 0; i < N; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
  const re = new Float64Array(N), im = new Float64Array(N);
  const half = N / 2;
  const binHz = sr / N;
  const bin = (hz) => Math.max(1, Math.min(half - 1, Math.round(hz / binHz)));
  const kickLo = bin(35), kickHi = bin(130);
  const bassLo = bin(25), bassHi = bin(160);
  const snLo1 = bin(180), snHi1 = bin(400), snLo2 = bin(2000), snHi2 = bin(6500);
  const allHi = bin(9000);

  const fluxAll = new Float64Array(frames), fluxKick = new Float64Array(frames), fluxSnare = new Float64Array(frames);
  const bassE = new Float64Array(frames);
  let prev = new Float64Array(half), cur = new Float64Array(half);
  for (let f = 0; f < frames; f++) {
    const off = f * HOP;
    for (let i = 0; i < N; i++) { re[i] = samples[off + i] * hann[i]; im[i] = 0; }
    fft(re, im);
    let fa = 0, fk = 0, fs = 0, be = 0;
    for (let k = 1; k < half; k++) {
      const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]) / N;
      cur[k] = Math.log1p(1000 * mag);
      if (f > 0) {
        const d = cur[k] - prev[k];
        if (d > 0) {
          if (k <= allHi) fa += d;
          if (k >= kickLo && k <= kickHi) fk += d;
          if ((k >= snLo1 && k <= snHi1) || (k >= snLo2 && k <= snHi2)) fs += d;
        }
      }
      if (k >= bassLo && k <= bassHi) be += mag * mag;
    }
    fluxAll[f] = fa; fluxKick[f] = fk; fluxSnare[f] = fs; bassE[f] = Math.sqrt(be);
    const t = prev; prev = cur; cur = t;
  }
  const envAll = normalizeEnv(fluxAll, fps);
  const envKick = normalizeEnv(fluxKick, fps);
  const envSnare = normalizeEnv(fluxSnare, fps);
  const frameTime = (f) => (f * HOP + N / 2) / sr;

  const kickIdx = pickPeaks(envKick, fps, { minGap: 0.12, k: 0.7, minAbs: 0.6 });
  let snareIdx = pickPeaks(envSnare, fps, { minGap: 0.12, k: 0.7, minAbs: 0.6 });
  snareIdx = snareIdx.filter((i) => {
    let kmax = 0;
    for (let j = Math.max(0, i - 2); j <= Math.min(frames - 1, i + 2); j++) kmax = Math.max(kmax, envKick[j]);
    return kmax < envSnare[i] * 0.9;
  });
  const onsetIdx = pickPeaks(envAll, fps, { minGap: 0.06, k: 0.5, minAbs: 0.4 });

  // Tempo + beats on a mix of full-band and kick onset strength
  const mix = new Float64Array(frames);
  for (let i = 0; i < frames; i++) mix[i] = envAll[i] + 0.7 * envKick[i];
  const tempo = estimateTempo(mix, fps);
  let beatIdx = frames > 8 ? trackBeats(mix, tempo.period) : [];
  let beats = beatIdx.map(frameTime);

  // Refine BPM by regression over tracked beats
  let bpm = tempo.bpm;
  if (beats.length > 8) {
    const nB = beats.length;
    let sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (let i = 0; i < nB; i++) { sx += i; sy += beats[i]; sxx += i * i; sxy += i * beats[i]; }
    const slope = (nB * sxy - sx * sy) / (nB * sxx - sx * sx);
    const reg = 60 / slope;
    if (Math.abs(reg - tempo.bpm) / tempo.bpm < 0.03) bpm = reg;
  }

  // Extend the beat grid over the full duration
  const periodSec = beats.length > 1 ? (beats[beats.length - 1] - beats[0]) / (beats.length - 1) : 60 / bpm;
  const fullBeats = [];
  if (beats.length) {
    let t = beats[0] - periodSec, pre = [];
    while (t > -periodSec * 0.25) { pre.push(Math.max(0, t)); t -= periodSec; }
    pre.reverse();
    const post = [];
    t = beats[beats.length - 1] + periodSec;
    while (t < duration + periodSec * 0.01) { post.push(t); t += periodSec; }
    fullBeats.push(...pre.filter((x) => x >= 0), ...beats, ...post.filter((x) => x <= duration));
  } else {
    for (let t = 0; t < duration; t += 60 / bpm) fullBeats.push(t);
  }
  beats = fullBeats;

  // Downbeat phase (4/4): beat index mod 4 with most kick/bass weight
  const at = (arr, tm) => { const f = Math.round((tm * sr - N / 2) / HOP); return f >= 0 && f < arr.length ? arr[f] : 0; };
  const phaseScore = [0, 0, 0, 0];
  const bassNormEnv = normalizeEnv(bassE, fps);
  beats.forEach((tm, i) => { phaseScore[i % 4] += at(envKick, tm) + 0.5 * at(bassNormEnv, tm) + 0.3 * at(envAll, tm); });
  let phase = 0;
  for (let p = 1; p < 4; p++) if (phaseScore[p] > phaseScore[phase] * 1.08) phase = p;
  const bars = beats.filter((_, i) => i % 4 === phase);

  // Energy curves at 4 Hz
  const step = 0.25;
  const bins = Math.max(1, Math.ceil(duration / step));
  const rms = new Float64Array(bins), bass = new Float64Array(bins);
  const winLen = Math.round(step * sr);
  for (let b = 0; b < bins; b++) {
    let s = 0; const a = b * winLen, e = Math.min(samples.length, a + winLen);
    for (let i = a; i < e; i++) s += samples[i] * samples[i];
    rms[b] = Math.sqrt(s / Math.max(1, e - a));
    const f0 = Math.floor((b * step * sr) / HOP), f1 = Math.min(frames, Math.ceil(((b + 1) * step * sr) / HOP));
    let bs = 0, c = 0;
    for (let f = f0; f < f1; f++) { bs += bassE[f]; c++; }
    bass[b] = c ? bs / c : 0;
  }
  const rmsS = movingAvg(rms, 3), bassS = movingAvg(bass, 3);
  const rmsRef = percentile(rmsS, 0.95) || 1, bassRef = percentile(bassS, 0.95) || 1;
  const energy = new Float64Array(bins), bassN = new Float64Array(bins);
  for (let b = 0; b < bins; b++) {
    bassN[b] = Math.min(1, bassS[b] / bassRef);
    energy[b] = Math.min(1, 0.6 * (rmsS[b] / rmsRef) + 0.4 * bassN[b]);
  }

  // Bars -> breakdowns & drops
  const kickTimes = kickIdx.map(frameTime);
  const barEnergy = [], barKicks = [];
  for (let i = 0; i < bars.length; i++) {
    const a = bars[i], b = i + 1 < bars.length ? bars[i + 1] : duration;
    const b0 = Math.floor(a / step), b1 = Math.max(b0 + 1, Math.floor(b / step));
    let s = 0, c = 0;
    for (let k = b0; k < b1 && k < bins; k++) { s += energy[k]; c++; }
    barEnergy.push(c ? s / c : 0);
    barKicks.push(kickTimes.filter((t) => t >= a && t < b).length);
  }
  const ref = percentile(barEnergy, 0.75) || 1;
  const low = barEnergy.map((e, i) => e < 0.55 * ref || (barKicks[i] === 0 && e < 0.8 * ref));
  const breakdowns = [];
  for (let i = 0; i < bars.length;) {
    if (!low[i]) { i++; continue; }
    let j = i;
    while (j + 1 < bars.length && low[j + 1]) j++;
    if (j - i + 1 >= 2) breakdowns.push({ start: round3(bars[i]), end: round3(j + 1 < bars.length ? bars[j + 1] : duration) });
    i = j + 1;
  }
  const drops = [];
  const pushDrop = (t, s) => {
    if (drops.length && t - drops[drops.length - 1].time < (4 * 60) / bpm) return;
    drops.push({ time: round3(t), strength: round3(s) });
  };
  for (let i = 1; i < bars.length; i++) {
    const wasLow = low[i - 1] && !low[i];
    const jump = barEnergy[i] > 1.6 * Math.max(barEnergy[i - 1], 0.02) && barEnergy[i] > 0.7 * ref;
    if (wasLow || jump) pushDrop(bars[i], barEnergy[i] / ref);
  }

  // Waveform peaks, 100 per second, 0..255
  const wfPer = Math.max(1, Math.round(sr / 100));
  const wfN = Math.ceil(samples.length / wfPer);
  const wf = new Uint8Array(wfN);
  let wmax = 1e-6;
  for (let i = 0; i < wfN; i++) {
    let m = 0; const a = i * wfPer, e = Math.min(samples.length, a + wfPer);
    for (let k = a; k < e; k++) { const v = Math.abs(samples[k]); if (v > m) m = v; }
    wf[i] = Math.min(255, Math.round(m * 255)); if (m > wmax) wmax = m;
  }

  const strength = (arr, idx) => idx.map((i) => [round3(frameTime(i)), round3(arr[i])]);
  return {
    version: 1,
    sampleRate: sr,
    duration: round3(duration),
    bpm: Math.round(bpm * 10) / 10,
    bpmConfidence: round3(tempo.confidence),
    beatPeriod: round3(60 / bpm),
    beats: beats.map(round3),
    downbeatPhase: phase,
    bars: bars.map(round3),
    kicks: strength(envKick, kickIdx),
    snares: strength(envSnare, snareIdx),
    onsets: onsetIdx.map((i) => round3(frameTime(i))),
    energyStep: step,
    energy: Array.from(energy, round3),
    bass: Array.from(bassN, round3),
    breakdowns,
    drops,
    waveform: Buffer.from(wf).toString('base64'),
    waveformRate: 100,
  };
}

module.exports = { analyze, HOP, N };
