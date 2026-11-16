/*
 * Tunewell pitch detection. Two stages, no dependencies.
 *
 * 1. Coarse: McLeod Pitch Method (normalized autocorrelation via FFT).
 *    It measures periodicity, so it finds the right note (no octave slips) even
 *    when a phone or laptop mic barely captures the fundamental.
 *
 * 2. Refine: inharmonicity-aware partial fit.
 *    Real strings are stiff, so partial n sits at n·f0·sqrt(1 + B·n²), slightly
 *    sharp of n·f0. Period-based detectors average that stretch and read guitar,
 *    bass and piano several cents sharp. We locate each partial in a
 *    Gaussian-windowed spectrum (log-parabolic peak interpolation is exact for a
 *    Gaussian window), then solve (f_n / n)² = f0² + f0²·B·n² by weighted least
 *    squares. That recovers the true fundamental (partial 1) and B even when
 *    partial 1 is nearly missing from the recording. If the fit is not trustworthy we keep the MPM result.
 *
 * Works in browsers (window.Pitch) and Node (module.exports).
 */
(function (root) {
  'use strict';

  function nextPow2(n) { let p = 1; while (p < n) p <<= 1; return p; }

  function FFT(M) {
    this.M = M;
    this.cos = new Float64Array(M / 2);
    this.sin = new Float64Array(M / 2);
    for (let i = 0; i < M / 2; i++) {
      this.cos[i] = Math.cos((-2 * Math.PI * i) / M);
      this.sin[i] = Math.sin((-2 * Math.PI * i) / M);
    }
    this.rev = new Uint32Array(M);
    const bits = Math.log2(M);
    for (let i = 0; i < M; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
  }
  FFT.prototype.run = function (re, im) {
    const M = this.M, rev = this.rev, cs = this.cos, sn = this.sin;
    for (let i = 0; i < M; i++) {
      const j = rev[i];
      if (i < j) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let len = 2; len <= M; len <<= 1) {
      const half = len >> 1, step = M / len;
      for (let i = 0; i < M; i += len) {
        for (let k = 0, w = 0; k < half; k++, w += step) {
          const wr = cs[w], wi = sn[w];
          const a = i + k, b = a + half;
          const br = re[b] * wr - im[b] * wi;
          const bi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - br; im[b] = im[a] - bi;
          re[a] += br; im[a] += bi;
        }
      }
    }
  };

  /**
   * @param {number} size  samples per analysis buffer (power of two recommended)
   * @param {{minFreq?:number, maxFreq?:number, k?:number, refine?:boolean}} [opts]
   */
  function PitchDetector(size, opts) {
    opts = opts || {};
    this.N = size;
    this.minFreq = opts.minFreq || 27;
    this.maxFreq = opts.maxFreq || 4500;
    this.k = opts.k || 0.9;
    this.refineOn = opts.refine !== false;
    this.M = nextPow2(size * 2); // zero padding: linear autocorrelation, 2x spectral interpolation
    this.fft = new FFT(this.M);
    this.x = new Float64Array(size);
    this.re = new Float64Array(this.M);
    this.im = new Float64Array(this.M);
    this.nsdf = new Float64Array(size);
    this.logMag = new Float64Array(this.M / 2);
    this.win = new Float64Array(size);
    const c = (size - 1) / 2, s = size / 7; // Gaussian, ~-54 dB at the edges
    for (let i = 0; i < size; i++) this.win[i] = Math.exp(-0.5 * ((i - c) / s) ** 2);
    this.floorTmp = new Float64Array(1024);
  }

  /** @returns {{freq:number, clarity:number, rms:number, coarse:number, B:number, partials:number}} */
  PitchDetector.prototype.detect = function (input, sampleRate) {
    const N = this.N, x = this.x, re = this.re, im = this.im, nsdf = this.nsdf;
    const none = (rms) => ({ freq: 0, clarity: 0, rms, coarse: 0, B: 0, partials: 0 });

    let mean = 0;
    for (let i = 0; i < N; i++) mean += input[i];
    mean /= N;
    let sumsq = 0;
    for (let i = 0; i < N; i++) { const v = input[i] - mean; x[i] = v; sumsq += v * v; }
    const rms = Math.sqrt(sumsq / N);
    if (sumsq === 0) return none(0);

    // ---- Stage 1: MPM ----
    re.fill(0); im.fill(0); re.set(x);
    this.fft.run(re, im);
    for (let i = 0; i < this.M; i++) { re[i] = re[i] * re[i] + im[i] * im[i]; im[i] = 0; }
    this.fft.run(re, im); // power spectrum is real & even: forward FFT == M * inverse
    const scale = 1 / this.M;

    const maxTau = Math.min(N >> 1, Math.floor(sampleRate / this.minFreq) + 1);
    const minTau = Math.max(2, Math.floor(sampleRate / this.maxFreq));
    let m = 2 * sumsq;
    nsdf[0] = 1;
    for (let tau = 1; tau <= maxTau; tau++) {
      m -= x[tau - 1] * x[tau - 1] + x[N - tau] * x[N - tau];
      nsdf[tau] = m > 1e-12 ? (2 * re[tau] * scale) / m : 0;
    }
    const peaks = [];
    let tau = 1;
    while (tau < maxTau && nsdf[tau] > 0) tau++;
    let inLobe = false, best = -1, bestVal = -Infinity;
    for (; tau < maxTau; tau++) {
      const v = nsdf[tau];
      if (v > 0) {
        if (!inLobe) { inLobe = true; best = -1; bestVal = -Infinity; }
        if (v > bestVal) { bestVal = v; best = tau; }
      } else if (inLobe) {
        inLobe = false;
        if (best >= minTau) peaks.push(best);
      }
    }
    if (inLobe && best >= minTau && best < maxTau - 1) peaks.push(best);
    if (!peaks.length) return none(rms);
    // Compare peaks by their interpolated height: for very short periods (C8 is
    // ~11 samples) the true peak falls between samples and the raw value is too
    // low, which would otherwise push the choice to twice the period.
    const interp = (t) => {
      const a = nsdf[t - 1], b = nsdf[t], c = nsdf[t + 1], den = a - 2 * b + c;
      if (den >= 0) return { t, v: b };
      const d = (0.5 * (a - c)) / den;
      return { t: t + d, v: b - 0.25 * (a - c) * d };
    };
    const ip = peaks.map(interp);
    let nmax = 0;
    for (const p of ip) if (p.v > nmax) nmax = p.v;
    let chosenP = ip[0];
    for (const p of ip) { if (p.v >= this.k * nmax) { chosenP = p; break; } }
    const coarse = sampleRate / chosenP.t;
    const clarity = Math.min(1, chosenP.v);

    const out = { freq: coarse, clarity, rms, coarse, B: 0, partials: 0 };
    if (this.refineOn && clarity > 0.5) this._refine(sampleRate, coarse, out);
    return out;
  };

  // ---- Stage 2: partial fit ----
  PitchDetector.prototype._refine = function (sr, f0c, out) {
    const N = this.N, M = this.M, re = this.re, im = this.im, x = this.x, win = this.win, L = this.logMag;
    re.fill(0); im.fill(0);
    for (let i = 0; i < N; i++) re[i] = x[i] * win[i];
    this.fft.run(re, im);
    const binHz = sr / M, half = M >> 1;
    const fTop = Math.min(sr * 0.45, 8000);
    const kTop = Math.min(half - 2, Math.floor(fTop / binHz));
    let peakL = -Infinity;
    const kLo = Math.max(1, Math.floor((0.5 * f0c) / binHz));
    for (let k = 1; k <= kTop; k++) {
      const v = 0.5 * Math.log(re[k] * re[k] + im[k] * im[k] + 1e-30);
      L[k] = v;
      if (k >= kLo && v > peakL) peakL = v;
    }
    // Noise floor: median log magnitude over the analysed band (subsampled)
    const step = Math.max(1, Math.floor(kTop / this.floorTmp.length));
    let cnt = 0;
    for (let k = 1; k <= kTop && cnt < this.floorTmp.length; k += step) this.floorTmp[cnt++] = L[k];
    const fl = this.floorTmp.subarray(0, cnt).sort();
    const floorL = fl[cnt >> 1];
    const minL = Math.max(floorL + 2.3 /* +20 dB */, peakL - 6.9 /* -60 dB */);

    const ns = [], fs = [], ws = [];
    let f0 = f0c, B = 0;
    const nMax = Math.min(40, Math.floor(fTop / f0c));
    let misses = 0;
    for (let n = 1; n <= nMax; n++) {
      const pred = n * f0 * Math.sqrt(1 + B * n * n);
      if (pred >= fTop) break;
      const span = Math.max(2, (0.12 * f0c) / binHz); // search ±12% of f0 around the prediction
      const k0 = Math.max(2, Math.round((pred / binHz) - span)), k1 = Math.min(kTop - 1, Math.round((pred / binHz) + span));
      let kb = -1, vb = -Infinity;
      for (let k = k0; k <= k1; k++) if (L[k] > vb) { vb = L[k]; kb = k; }
      if (kb <= k0 || kb >= k1 || vb < minL || L[kb - 1] > vb || L[kb + 1] > vb) {
        if (++misses > 6 && ns.length >= 3) break;
        continue;
      }
      const la = L[kb - 1], lc = L[kb + 1], d = la - 2 * vb + lc;
      const p = d !== 0 ? (0.5 * (la - lc)) / d : 0;
      if (Math.abs(p) > 1) continue;
      const fn = (kb + p) * binHz, amp = vb - 0.25 * (la - lc) * p;
      ns.push(n); fs.push(fn);
      // precision of f_n/n grows with n; weight by SNR too
      ws.push(n * n * Math.exp(2 * Math.min(amp - floorL, 7)));
      if (ns.length >= 3) { const r = fit(ns, fs, ws, ns.length >= 4); if (r) { f0 = r.f0; B = r.B; } }
      else f0 = fn / n; // track as we go so later predictions stay on target
    }
    if (!ns.length) return;
    let r;
    if (ns[0] === 1 && ns.length < 4) {
      // Treble notes: too few partials to fit B, but the fundamental itself is
      // strong and unaffected by inharmonicity, so read it directly.
      r = { f0: fs[0], B: 0 };
    } else {
      if (ns.length < 2) return;
      r = fit(ns, fs, ws, ns.length >= 4 && ns[ns.length - 1] - ns[0] >= 3);
      if (!r) return;
    }
    // Trust the refinement only if it agrees with the MPM estimate to within 40 cents
    if (Math.abs(1200 * Math.log2(r.f0 / f0c)) > 40) return;
    out.freq = r.f0; out.B = r.B; out.partials = ns.length;
  };

  // Weighted least squares of y = (f_n/n)^2 against u = n^2: y = a + b u, B = b/a.
  // Returned f0 is the first partial, sqrt(a + b): the fundamental a tuner should show.
  function fit(ns, fs, ws, withB) {
    let sw = 0, su = 0, sy = 0, suu = 0, suy = 0;
    for (let i = 0; i < ns.length; i++) {
      const n = ns[i], u = n * n, y = (fs[i] / n) ** 2, w = ws[i];
      sw += w; su += w * u; sy += w * y; suu += w * u * u; suy += w * u * y;
    }
    if (sw <= 0) return null;
    let a = sy / sw, b = 0;
    if (withB) {
      const det = sw * suu - su * su;
      if (det > 0) {
        const bb = (sw * suy - su * sy) / det;
        if (bb > 0) { b = bb; a = (sy - b * su) / sw; }
      }
    }
    if (!(a > 0)) return null;
    return { f0: Math.sqrt(a + b), B: Math.min(0.05, b / a) };
  }

  const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
  function freqToMidi(freq, a4) { return 69 + 12 * Math.log2(freq / (a4 || 440)); }
  function midiToFreq(midi, a4) { return (a4 || 440) * Math.pow(2, (midi - 69) / 12); }
  function midiName(midi) {
    const n = Math.round(midi);
    return { name: NAMES[((n % 12) + 12) % 12], octave: Math.floor(n / 12) - 1 };
  }
  /** "E2" -> 40, "Eb3"/"E♭3" -> 51 */
  function parseNote(s) {
    const m = /^([A-G])([#♯b♭]?)(-?\d)$/.exec(s);
    if (!m) throw new Error('Bad note ' + s);
    const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]];
    const acc = m[2] === '#' || m[2] === '♯' ? 1 : m[2] === 'b' || m[2] === '♭' ? -1 : 0;
    return (parseInt(m[3], 10) + 1) * 12 + base + acc;
  }

  const api = { PitchDetector, freqToMidi, midiToFreq, midiName, parseNote, NAMES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Pitch = api;
})(typeof self !== 'undefined' ? self : this);
