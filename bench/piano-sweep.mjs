// Piano sweep: every key A0–C8 (stiff-string model); prints any key off by more than 1 cent. Run: N=8192 node piano-sweep.mjs
import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);
const Ours = require('../pitch.js');
import { SR, N, midiHz, inharm, rand, render } from './signals.mjs';
const det = new Ours.PitchDetector(N);
for (let m = 21; m <= 108; m++) {
  const f0 = midiHz(m); const logB = m < 60 ? -3.6 + (m - 21) / 39 * 0.2 : -3.4 + (m - 60) / 48 * 1.7, B = 10 ** logB;
  const maxN = Math.max(2, Math.min(30, Math.floor(6000 / f0))); const parts = [];
  for (let n = 1; n <= maxN; n++) parts.push({ n, f: inharm(f0, n, B), a: (0.5 + rand()) * (n === 1 && f0 < 100 ? 0.3 : 1) / Math.pow(n, 1.2) });
  const r = det.detect(render(parts, { snr: 25, fc: 120, decay: 2 }), SR);
  const f1 = inharm(f0, 1, B), c = 1200 * Math.log2(r.freq / f1), cc = 1200 * Math.log2(r.coarse / f1);
  if (!(Math.abs(c) <= 1)) console.log(m, f0.toFixed(1), 'B', B.toExponential(1), 'maxN', maxN, '| final', c.toFixed(1), 'coarse', cc.toFixed(1), 'partials', r.partials, 'clar', r.clarity.toFixed(2));
}
