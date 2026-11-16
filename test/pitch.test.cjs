// Synthetic-signal tests: weak fundamentals (cheap mic high-pass), noise, both common sample rates.
const { PitchDetector, freqToMidi } = require('../pitch.js');
let seed = 1; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
function tone(f, sr, n, { h1 = 1, noise = 0, B = 0, harm = [1, 0.7, 0.5, 0.35, 0.25, 0.15] } = {}) {
  const b = new Float32Array(n), ph = harm.map(() => Math.random() * 6.28);
  for (let i = 0; i < n; i++) {
    let v = 0;
    harm.forEach((a, k) => { const fk = (k + 1) * f * Math.sqrt(1 + B * (k + 1) ** 2); if (fk < sr / 2) v += (k === 0 ? a * h1 : a) * Math.sin(2 * Math.PI * fk * i / sr + ph[k]); });
    b[i] = 0.2 * v + noise * rnd();
  }
  return b;
}
const notes = { A0: 27.5, B0: 30.87, E1: 41.2, C2: 65.41, E2: 82.41, A2: 110, C3: 130.81, G3: 196, D4: 293.66, A4: 440, E5: 659.25, A5: 880, C7: 2093, C8: 4186.01 };
const cases = [
  ['clean', {}], ['weak fundamental (h1=0.05)', { h1: 0.05 }], ['no fundamental', { h1: 0 }],
  ['stiff string (B=2e-4, weak fund.)', { h1: 0.1, B: 2e-4 }],
  ['noisy (SNR ~10dB)', { noise: 0.05 }], ['weak fund + noise', { h1: 0.1, noise: 0.04 }],
];
let fail = 0, worst = 0;
for (const sr of [44100, 48000, 96000]) {
  let N = 1024; while (N < sr * 0.16) N <<= 1; // same rule as app.js
  const d = new PitchDetector(N);
  for (const [label, o] of cases) for (const [name, f] of Object.entries(notes)) {
    if (o.h1 !== undefined && o.h1 < 0.5 && f > 1000) continue; // mics only lose *bass* fundamentals
    // Single frame: <1.5c clean, <4c in noise. Median of 7 frames (what the app shows): <1.5c clean, <2c at ~10 dB SNR.
    const noisy = !!o.noise, est = [], truth = f * Math.sqrt(1 + (o.B || 0));
    for (let k = 0; k < (noisy ? 7 : 1); k++) { const r = d.detect(tone(f, sr, N, o), sr); est.push(r.freq ? 100 * (freqToMidi(r.freq) - freqToMidi(truth)) : NaN); }
    const single = est[0]; est.sort((a, b) => a - b); const cents = est[est.length >> 1];
    const r = { freq: f * Math.pow(2, cents / 1200), clarity: 1 };
    const ok = Math.abs(cents) < (noisy ? 2 : 1.5) && Math.abs(single) < (noisy ? 4 : 1.5);
    if (ok) worst = Math.max(worst, Math.abs(cents));
    if (!ok) { fail++; console.log(`FAIL sr=${sr} ${label} ${name}: got ${r.freq.toFixed(2)} Hz (${cents.toFixed(1)}¢) clarity ${r.clarity.toFixed(2)}`); }
  }
}
// Silence / pure noise must not report a confident pitch
const d = new PitchDetector(8192);
const noise = new Float32Array(8192).map(() => 0.05 * rnd());
const rn = d.detect(noise, 48000);
if (rn.freq && rn.clarity > 0.85) { fail++; console.log('FAIL noise reported pitch', rn); }
if (d.detect(new Float32Array(8192), 48000).freq !== 0) { fail++; console.log('FAIL silence'); }
// Speed
const buf = tone(82.41, 48000, 8192); const t = performance.now();
for (let i = 0; i < 300; i++) d.detect(buf, 48000);
console.log(`worst passing error ${worst.toFixed(3)}¢, ${((performance.now() - t) / 300).toFixed(2)} ms/frame, noise clarity ${rn.clarity.toFixed(2)}`);
console.log(fail ? `${fail} FAILED` : 'ALL PASS'); process.exit(fail ? 1 : 0);
