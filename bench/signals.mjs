// Synthetic instrument signals as heard through a phone/laptop mic.
export const SR = 48000;
export let N = +(process.env.N || 4096);
// ---------- deterministic randomness ----------
let seed = 12345;
export const setSeed = (s) => { seed = s; };
export const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
export const gauss = () => Math.sqrt(-2 * Math.log(rand() + 1e-12)) * Math.cos(2 * Math.PI * rand());
export const pick = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1));
export const midiHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

// Mic low-cut, 2nd order (phones/laptops roll off the bass)
export const micGain = (f, fc) => { const r = (f / fc) ** 2; return r / Math.sqrt(1 + r * r); };

export function render(partials, { snr = 30, fc = 150, decay = 0 } = {}) {
  const x = new Float64Array(N);
  for (const p of partials) {
    if (p.f >= SR / 2 - 200) continue;
    const a = p.a * micGain(p.f, fc), ph = rand() * 2 * Math.PI, w = 2 * Math.PI * p.f / SR;
    const d = decay * p.n;
    for (let i = 0; i < N; i++) x[i] += a * Math.sin(w * i + ph) * Math.exp(-d * i / SR);
  }
  let ps = 0; for (let i = 0; i < N; i++) ps += x[i] * x[i];
  ps /= N;
  // Room noise: white, gently low-passed
  const nAmp = Math.sqrt(ps / Math.pow(10, snr / 10));
  const nz = new Float64Array(N); let lp = 0, pn = 0;
  for (let i = 0; i < N; i++) { lp += 0.3 * (gauss() - lp); nz[i] = lp; pn += lp * lp; }
  const k = nAmp / Math.sqrt(pn / N || 1);
  // Normalize to a plausible mic level (peak ~0.3)
  let peak = 0; for (let i = 0; i < N; i++) { x[i] += k * nz[i]; peak = Math.max(peak, Math.abs(x[i])); }
  const out = new Float32Array(N), g = 0.3 / (peak || 1);
  for (let i = 0; i < N; i++) out[i] = x[i] * g;
  return out;
}

// ---------- instrument models ----------
// Stiff strings: partial n = n*f0*sqrt(1+B n^2). Ground truth is partial 1, the real fundamental.
export const inharm = (f0, n, B) => n * f0 * Math.sqrt(1 + B * n * n);
export const models = {
  'Guitar (E2–E5, phone mic)': () => {
    const m = pick(40, 76), f0 = midiHz(m), B = 1.2e-4;
    const parts = []; for (let n = 1; n <= 20; n++) parts.push({ n, f: inharm(f0, n, B), a: (0.6 + 0.8 * rand()) / n });
    return { f0: inharm(f0, 1, B), sig: render(parts, { snr: 25, fc: 150, decay: 3 }) };
  },
  'Bass (E1–G3, phone mic)': () => {
    const m = pick(28, 55), f0 = midiHz(m), B = 2e-4;
    const parts = []; for (let n = 1; n <= 16; n++) parts.push({ n, f: inharm(f0, n, B), a: (0.6 + 0.8 * rand()) / n });
    return { f0: inharm(f0, 1, B), sig: render(parts, { snr: 25, fc: 150, decay: 2 }) };
  },
  'Bowed: cello/viola/violin (C2–A6)': () => {
    const m = pick(36, 93), f0 = midiHz(m); // bowed strings are exactly harmonic
    const parts = []; for (let n = 1; n <= 30; n++) parts.push({ n, f: n * f0, a: (0.7 + 0.6 * rand()) / n });
    return { f0, sig: render(parts, { snr: 20, fc: 100 }) };
  },
  'Piano (A0–C8, inharmonic)': () => {
    const m = pick(21, 108), f0 = midiHz(m);
    const logB = m < 60 ? -3.6 + (m - 21) / 39 * 0.2 : -3.4 + (m - 60) / 48 * 1.7, B = Math.pow(10, logB);
    const parts = [];
    const maxN = Math.max(2, Math.min(30, Math.floor(6000 / f0)));
    for (let n = 1; n <= maxN; n++) parts.push({ n, f: inharm(f0, n, B), a: (0.5 + rand()) * (n === 1 && f0 < 100 ? 0.3 : 1) / Math.pow(n, 1.2) });
    return { f0: inharm(f0, 1, B), sig: render(parts, { snr: 25, fc: 120, decay: 2 }) };
  },
  'Noisy room (SNR 10 dB, any)': () => {
    const m = pick(36, 84), f0 = midiHz(m);
    const parts = []; for (let n = 1; n <= 20; n++) parts.push({ n, f: n * f0, a: (0.6 + 0.8 * rand()) / n });
    return { f0, sig: render(parts, { snr: 10, fc: 150 }) };
  },
};

