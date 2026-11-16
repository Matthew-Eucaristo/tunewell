// Benchmark: our detector vs popular open-source JS pitch detectors on realistic synthetic signals.
// Run: cd bench && npm install && node bench.mjs
import { createRequire } from 'node:module';
import { PitchDetector as Pitchy } from 'pitchy';
import { YIN, Macleod, ACF2PLUS, DynamicWavelet } from 'pitchfinder';
const require = createRequire(import.meta.url);
const Ours = require('../pitch.js');

import { SR, N, models, render, setSeed } from './signals.mjs';
const TRIALS = +(process.env.TRIALS || 150);

// ---------- detectors (each with its library defaults + typical app gate) ----------
function cwilso(buf, sampleRate) { // the classic "PitchDetect" autocorrelation copied by many web tuners
  let size = buf.length, rms = 0;
  for (let i = 0; i < size; i++) rms += buf[i] * buf[i];
  if (Math.sqrt(rms / size) < 0.01) return -1;
  let r1 = 0, r2 = size - 1; const thres = 0.2;
  for (let i = 0; i < size / 2; i++) if (Math.abs(buf[i]) < thres) { r1 = i; break; }
  for (let i = 1; i < size / 2; i++) if (Math.abs(buf[size - i]) < thres) { r2 = size - i; break; }
  buf = buf.slice(r1, r2); size = buf.length;
  const c = new Float64Array(size);
  for (let i = 0; i < size; i++) for (let j = 0; j < size - i; j++) c[i] += buf[j] * buf[j + i];
  let d = 0; while (c[d] > c[d + 1]) d++;
  let maxval = -1, maxpos = -1;
  for (let i = d; i < size; i++) if (c[i] > maxval) { maxval = c[i]; maxpos = i; }
  let T0 = maxpos; const x1 = c[T0 - 1], x2 = c[T0], x3 = c[T0 + 1];
  const a = (x1 + x3 - 2 * x2) / 2, b = (x3 - x1) / 2;
  if (a) T0 = T0 - b / (2 * a);
  return sampleRate / T0;
}

const ours = new Ours.PitchDetector(N, { minFreq: 27, maxFreq: 4500 });
const oursMpm = new Ours.PitchDetector(N, { minFreq: 27, maxFreq: 4500, refine: false });
const pitchy = Pitchy.forFloat32Array(N);
const yin = YIN({ sampleRate: SR });
const mac = Macleod({ sampleRate: SR, bufferSize: N });
const acf = ACF2PLUS({ sampleRate: SR });
const dw = DynamicWavelet({ sampleRate: SR });

const detectors = {
  'Tunewell (ours)': (b) => { const r = ours.detect(b, SR); return r.clarity >= 0.88 ? r.freq : 0; },
  'Tunewell, MPM stage only': (b) => { const r = oursMpm.detect(b, SR); return r.clarity >= 0.88 ? r.freq : 0; },
  'pitchy (MPM)': (b) => { const [f, c] = pitchy.findPitch(b, SR); return c >= 0.9 ? f : 0; },
  'pitchfinder YIN': (b) => yin(b) || 0,
  'pitchfinder MPM': (b) => { const r = mac(b); return r && r.probability >= 0.9 ? r.freq : 0; },
  'pitchfinder ACF2+': (b) => acf(b) || 0,
  'pitchfinder Wavelet': (b) => dw(b) || 0,
  'cwilso autocorrelation': (b) => { const f = cwilso(b, SR); return f > 0 && isFinite(f) ? f : 0; },
};

// ---------- run ----------
const results = {};
const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
for (const [cat, gen] of Object.entries(models)) {
  setSeed(777 + cat.length); // same signals for every detector
  const sigs = Array.from({ length: TRIALS }, gen);
  for (const [name, fn] of Object.entries(detectors)) {
    if (only && !only.test(name)) continue;
    const errs = []; let miss = 0, gross = 0; const t = performance.now();
    for (const { f0, sig } of sigs) {
      const f = fn(sig);
      if (!f || !isFinite(f) || f <= 0) { miss++; continue; }
      const c = 1200 * Math.log2(f / f0);
      if (Math.abs(c) > 50) gross++; else errs.push(Math.abs(c));
    }
    const ms = (performance.now() - t) / sigs.length;
    errs.sort((a, b) => a - b);
    (results[name] ||= {})[cat] = {
      correct: (100 * errs.length / sigs.length), gross: (100 * gross / sigs.length), miss: (100 * miss / sigs.length),
      med: errs.length ? errs[errs.length >> 1] : NaN, p95: errs.length ? errs[Math.floor(errs.length * 0.95)] : NaN, ms,
    };
  }
}
// False positives on pure noise
setSeed(99);
const noise = Array.from({ length: TRIALS }, () => render([], { snr: -100 }));
for (const [name, fn] of Object.entries(detectors)) {
  if (only && !only.test(name)) continue;
  let fp = 0; for (const s of noise) { const f = fn(s); if (f && isFinite(f) && f > 0) fp++; }
  results[name].noiseFP = 100 * fp / noise.length;
}

const f1 = (v) => (isNaN(v) ? '  –  ' : v.toFixed(1).padStart(5));
for (const cat of Object.keys(models)) {
  console.log(`\n${cat}   (${TRIALS} notes, ${Math.round(N / SR * 1000)} ms window @ 48 kHz)`);
  console.log('  detector                 correct  wrong  none  median¢  p95¢   ms');
  for (const [name, r] of Object.entries(results)) {
    const x = r[cat]; if (!x) continue;
    console.log(`  ${name.padEnd(24)} ${f1(x.correct)}%  ${f1(x.gross)}% ${f1(x.miss)}%  ${f1(x.med)}  ${f1(x.p95)} ${f1(x.ms)}`);
  }
}
console.log('\nFalse readings on pure noise (lower is better)');
for (const [name, r] of Object.entries(results)) console.log(`  ${name.padEnd(24)} ${f1(r.noiseFP)}%`);
if (process.env.JSON) require('node:fs').writeFileSync(process.env.JSON, JSON.stringify(results, null, 1));
