# Tunewell

Free, open-source instrument tuner that runs in the browser. No ads, no install, no tracking; audio never leaves the device.

Presets: chromatic, guitar (standard, drop D), viola, violin, cello, bass, ukulele. Adjustable reference pitch (A4 = 415–466 Hz).

## Run locally

```bash
python3 -m http.server 8765
```

Open http://localhost:8765. The microphone needs a secure page: `https://` or `localhost`.

## Deploy

Any static host works (GitHub Pages, Cloudflare Pages, Netlify). Upload `index.html`, `pitch.js`, `app.js`.

## How it works

Two stages in `pitch.js`, no dependencies:

1. **McLeod Pitch Method** finds the period of the waveform. It works even when a small phone or laptop mic barely captures the fundamental, so it doesn't slip an octave.
2. **Inharmonicity-aware partial fit.** Real strings are stiff, so partial *n* sits at n·f0·√(1+B·n²), slightly sharp. Period-based detectors average that stretch and read guitar, bass and piano 5–12 cents sharp. Tunewell finds each partial in a Gaussian-windowed spectrum, then solves for the true fundamental and B with weighted least squares.

`app.js` asks the browser for raw audio (echo cancellation, noise suppression and auto gain off), analyses ~170 ms at a time (enough for piano A0 at 27.5 Hz), learns the room's noise floor, rejects octave slips and smooths with a running median.

## Benchmark

Same 170 ms buffers for every detector, 150 synthetic notes per row, modelled as heard through a phone mic (low-cut, room noise, stiff-string inharmonicity). The table shows median error in cents, with the share of notes read in the wrong semitone or not at all in brackets.

| | Guitar | Bass | Bowed strings | Piano A0–C8 | Noisy room (10 dB) | False readings on noise |
|---|---|---|---|---|---|---|
| **Tunewell** | **0.0** | **0.1** | **0.0** | **0.0** | **0.1** | **0%** |
| pitchy (MPM) | 5.1 | 8.9 | 0.1 | 8.9 (1%) | 0.3 (1%) | 0% |
| pitchfinder YIN | 7.4 | 11.6 | 0.2 | 12.1 (3%) | 0.6 (12%) | 100% |
| pitchfinder MPM | 5.2 (1%) | 8.1 (41%) | 0.1 (30%) | 8.1 (30%) | 0.3 (49%) | 0% |
| pitchfinder ACF2+ | 5.3 | 9.1 | 0.1 (13%) | 9.0 (7%) | 0.3 (5%) | 0% |
| cwilso autocorrelation | 5.3 | 9.1 | 0.1 (13%) | 9.0 (7%) | 0.3 (5%) | 0% |

Tunewell takes about 1 ms per frame. The signals are synthetic, so recordings of real instruments are the next check.

```bash
cd bench && npm install && N=8192 node bench.mjs
```

## Test

```bash
node test/pitch.test.cjs
```

## License

MIT
