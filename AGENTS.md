# Tunewell

Static, dependency-free browser tuner. No build step.

- `pitch.js`: pure pitch math: MPM coarse estimate, then inharmonicity-aware partial fit (reports partial 1, not the ideal-string f0), note helpers. Works in browser (`window.Pitch`) and Node (`module.exports`). Keep it DOM-free.
- `app.js`: mic capture, smoothing, UI. `index.html`: markup + inline CSS tokens (light/dark).
- Invariants: request getUserMedia with echoCancellation/noiseSuppression/autoGainControl false; analysis window ~170 ms (next power of two ≥ 0.16·sampleRate; shorter windows break piano A0); range 27–4500 Hz; no network calls, no trackers.
- Verify: `node test/pitch.test.cjs`; detector changes also run `cd bench && N=8192 node bench.mjs` (vs pitchy/pitchfinder/cwilso; ours must stay best on every row) and `node piano-sweep.mjs`. For UI, serve with `python3 -m http.server` and fake the mic by overriding `navigator.mediaDevices.getUserMedia` to return a fresh oscillator `MediaStreamDestination` stream per call (Stop ends the track). A hidden browser pane pauses requestAnimationFrame.
