/* Tunewell — UI, mic capture and smoothing. Pitch math lives in pitch.js. */
(function () {
  'use strict';
  const { PitchDetector, freqToMidi, midiToFreq, midiName, parseNote } = window.Pitch;

  // Strings listed low to high as players name them; flats stay flats (E♭ tuning reads E♭, not D♯).
  const PRESETS = {
    chromatic: { group: 'Any instrument', label: 'Chromatic', strings: [] },
    piano: { group: 'Any instrument', label: 'Piano (A0–C8)', strings: [] },
    guitar: { group: 'Guitar', label: 'Guitar · Standard', strings: ['E2', 'A2', 'D3', 'G3', 'B3', 'E4'] },
    guitarDropD: { group: 'Guitar', label: 'Guitar · Drop D', strings: ['D2', 'A2', 'D3', 'G3', 'B3', 'E4'] },
    guitarEb: { group: 'Guitar', label: 'Guitar · Half step down', strings: ['Eb2', 'Ab2', 'Db3', 'Gb3', 'Bb3', 'Eb4'] },
    guitarOpenG: { group: 'Guitar', label: 'Guitar · Open G', strings: ['D2', 'G2', 'D3', 'G3', 'B3', 'D4'] },
    guitarDADGAD: { group: 'Guitar', label: 'Guitar · DADGAD', strings: ['D2', 'A2', 'D3', 'G3', 'A3', 'D4'] },
    bass: { group: 'Bass', label: 'Bass · 4 string', strings: ['E1', 'A1', 'D2', 'G2'] },
    bass5: { group: 'Bass', label: 'Bass · 5 string', strings: ['B0', 'E1', 'A1', 'D2', 'G2'] },
    violin: { group: 'Orchestral strings', label: 'Violin', strings: ['G3', 'D4', 'A4', 'E5'] },
    viola: { group: 'Orchestral strings', label: 'Viola', strings: ['C3', 'G3', 'D4', 'A4'] },
    cello: { group: 'Orchestral strings', label: 'Cello', strings: ['C2', 'G2', 'D3', 'A3'] },
    doubleBass: { group: 'Orchestral strings', label: 'Double bass', strings: ['E1', 'A1', 'D2', 'G2'] },
    ukulele: { group: 'Folk', label: 'Ukulele · GCEA', strings: ['G4', 'C4', 'E4', 'A4'] },
    mandolin: { group: 'Folk', label: 'Mandolin', strings: ['G3', 'D4', 'A4', 'E5'] },
    banjo: { group: 'Folk', label: 'Banjo · Open G', strings: ['G4', 'D3', 'G3', 'B3', 'D4'] },
  };
  const prettyName = (s) => s.replace(/-?\d+$/, '').replace('#', '♯').replace('b', '♭');
  const IN_TUNE = 3;          // cents
  const MIN_CLARITY = 0.88;   // MPM confidence for a usable frame
  const HOLD_MS = 1500;       // keep the last note on screen after the sound stops
  const TRACE_LEN = 240;      // ~4 s at 60 fps

  const $ = (id) => document.getElementById(id);
  const app = $('app'), noteEl = $('note'), centsEl = $('cents'), hzEl = $('hz'), statusEl = $('status');
  const needle = $('needle'), stringsEl = $('strings'), startBtn = $('start'), msg = $('msg'), diag = $('diag');
  const presetSel = $('preset'), refVal = $('refVal'), levelEl = $('level'), hint = $('hint');

  const store = {
    get(k, d) { try { const v = localStorage.getItem('tunewell.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('tunewell.' + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
  };

  let presetKey = PRESETS[store.get('preset', 'guitar')] ? store.get('preset', 'guitar') : 'guitar';
  let a4 = Math.min(466, Math.max(415, store.get('a4', 440)));
  let locked = null;          // index of a locked string, or null for auto
  let strings = [];           // midi numbers of current preset
  let labels = [];            // their display names
  let lastIdx = -2, lastOk = null; // string highlight cache

  // ---------- static UI ----------
  const groups = {};
  for (const [k, p] of Object.entries(PRESETS)) {
    if (!groups[p.group]) { groups[p.group] = document.createElement('optgroup'); groups[p.group].label = p.group; presetSel.appendChild(groups[p.group]); }
    const o = document.createElement('option'); o.value = k; o.textContent = p.label; groups[p.group].appendChild(o);
  }
  presetSel.value = presetKey;
  presetSel.addEventListener('change', () => { presetKey = presetSel.value; store.set('preset', presetKey); locked = null; buildStrings(); });

  function setRef(v) { a4 = Math.min(466, Math.max(415, v)); refVal.textContent = 'A4 ' + a4; store.set('a4', a4); buildStrings(); }
  $('refDown').addEventListener('click', () => setRef(a4 - 1));
  $('refUp').addEventListener('click', () => setRef(a4 + 1));
  refVal.textContent = 'A4 ' + a4;

  function noteHTML(midi, label) {
    const { octave } = midiName(midi), name = label || midiName(midi).name;
    return name[0] + (name[1] ? '<span class="acc">' + name[1] + '</span>' : '') + '<sub>' + octave + '</sub>';
  }

  function buildStrings() {
    const names = PRESETS[presetKey].strings;
    strings = names.map(parseNote);
    labels = names.map(prettyName);
    lastIdx = -2;
    stringsEl.innerHTML = '';
    hint.textContent = presetKey === 'piano' ? 'Play one key at a time and hold it. Stretch tuning is not applied.'
      : strings.length ? 'Tap a string to lock it. Auto picks the closest one.' : 'Shows the nearest note for any instrument or voice.';
    if (!strings.length) return;
    const auto = document.createElement('button');
    auto.className = 'auto' + (locked == null ? ' on' : '');
    auto.textContent = 'Auto';
    auto.setAttribute('aria-pressed', String(locked == null));
    auto.addEventListener('click', () => { locked = null; buildStrings(); });
    stringsEl.appendChild(auto);
    strings.forEach((m, i) => {
      const b = document.createElement('button');
      const name = labels[i], octave = midiName(m).octave;
      b.innerHTML = '<b>' + name + '</b><small>' + name + octave + ' · ' + midiToFreq(m, a4).toFixed(1) + '</small>';
      b.setAttribute('aria-label', 'Lock to ' + name + octave);
      b.setAttribute('aria-pressed', String(locked === i));
      if (locked === i) b.classList.add('locked');
      b.addEventListener('click', () => { locked = locked === i ? null : i; buildStrings(); });
      stringsEl.appendChild(b);
    });
  }
  buildStrings();

  // Meter scale: ticks every 5 cents from -50 to +50
  (function drawScale() {
    const svg = $('scale');
    svg.setAttribute('viewBox', '0 0 100 74');
    let s = '';
    for (let c = -50; c <= 50; c += 5) {
      const x = 50 + c, major = c % 25 === 0;
      s += '<line class="tick' + (major ? ' major' : '') + '" x1="' + x + '" x2="' + x + '" y1="' + (major ? 50 : 56) + '" y2="66" vector-effect="non-scaling-stroke"/>';
    }
    svg.innerHTML = s;
    // Labels as HTML-free text would stretch with preserveAspectRatio=none, so place them in a second svg
    const lab = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    lab.setAttribute('style', 'position:absolute;inset:0;width:100%;height:100%;overflow:visible');
    lab.innerHTML = [-50, -25, 0, 25, 50].map((c) => {
      const pct = 50 + c, anchor = c === -50 ? 'start' : c === 50 ? 'end' : 'middle';
      return '<text x="' + (pct === 0 ? 1 : pct === 100 ? 99 : pct) + '%" y="18" text-anchor="' + anchor + '">' + (c > 0 ? '+' + c : c) + '</text>';
    }).join('');
    svg.parentNode.appendChild(lab);
  })();

  // ---------- trace ----------
  const trace = $('trace'), tctx = trace.getContext('2d');
  const traceData = new Float32Array(TRACE_LEN).fill(NaN);
  let colors = {};
  function readColors() {
    const cs = getComputedStyle(document.documentElement);
    colors = { line: cs.getPropertyValue('--line').trim(), good: cs.getPropertyValue('--good-soft').trim(), accent: cs.getPropertyValue('--accent').trim(), surface: cs.getPropertyValue('--surface').trim() };
  }
  readColors();
  try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { readColors(); drawTrace(); }); } catch (e) { /* old Safari */ }
  function drawTrace() {
    const dpr = window.devicePixelRatio || 1, w = trace.clientWidth, h = trace.clientHeight;
    if (trace.width !== Math.round(w * dpr)) { trace.width = Math.round(w * dpr); trace.height = Math.round(h * dpr); }
    tctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    tctx.fillStyle = colors.surface; tctx.fillRect(0, 0, w, h);
    const y = (c) => h / 2 - (Math.max(-50, Math.min(50, c)) / 50) * (h / 2 - 4);
    tctx.fillStyle = colors.good; tctx.fillRect(0, y(IN_TUNE), w, y(-IN_TUNE) - y(IN_TUNE));
    tctx.strokeStyle = colors.line; tctx.lineWidth = 1; tctx.beginPath(); tctx.moveTo(0, h / 2); tctx.lineTo(w, h / 2); tctx.stroke();
    tctx.strokeStyle = colors.accent; tctx.lineWidth = 2; tctx.lineJoin = 'round'; tctx.beginPath();
    let pen = false;
    for (let i = 0; i < TRACE_LEN; i++) {
      const v = traceData[i], x = (i / (TRACE_LEN - 1)) * w;
      if (Number.isNaN(v)) { pen = false; continue; }
      if (pen) tctx.lineTo(x, y(v)); else { tctx.moveTo(x, y(v)); pen = true; }
    }
    tctx.stroke();
  }
  drawTrace();
  window.addEventListener('resize', drawTrace);

  // ---------- audio ----------
  let ctx = null, stream = null, analyser = null, det = null, buf = null, sr = 48000, raf = 0, wakeLock = null;
  let noiseFloor = 0.002, hist = [], stableMidi = null, pending = [], dispMidi = null, lastVoiced = 0, inTuneSince = 0;

  async function start() {
    msg.classList.remove('err');
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      return fail('The microphone only works on secure pages. Open this tuner over https:// (or localhost).');
    }
    startBtn.disabled = true; msg.textContent = 'Asking for microphone…';
    try {
      // Turn off call-style processing: it is tuned for voices and smears sustained notes.
      const raw = { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 };
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: raw }); }
      catch (e) { if (e.name === 'OverconstrainedError') stream = await navigator.mediaDevices.getUserMedia({ audio: true }); else throw e; }

      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC({ latencyHint: 'interactive' });
      await ctx.resume();
      sr = ctx.sampleRate;
      // ~170 ms of audio whatever the device rate: long enough to resolve piano A0 (27.5 Hz)
      let N = 1024; while (N < sr * 0.16) N <<= 1;
      const src = ctx.createMediaStreamSource(stream);
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 25; hp.Q.value = 0.7;
      analyser = ctx.createAnalyser(); analyser.fftSize = N; analyser.smoothingTimeConstant = 0;
      src.connect(hp); hp.connect(analyser);
      det = new PitchDetector(N, { minFreq: 27, maxFreq: 4500 });
      buf = new Float32Array(N);

      showDiag(stream.getAudioTracks()[0]);
      requestWakeLock();
      startBtn.textContent = 'Stop'; startBtn.classList.add('stop'); startBtn.disabled = false;
      msg.textContent = 'Listening. Play one string at a time and let it ring.';
      statusEl.textContent = 'Play a string';
      raf = requestAnimationFrame(loop);
    } catch (e) {
      stop();
      if (e.name === 'NotAllowedError' || e.name === 'SecurityError') fail('Microphone access is blocked. Allow it for this site in your browser settings, then tap Start again.');
      else if (e.name === 'NotFoundError') fail('No microphone found. Plug one in or check your system sound settings.');
      else fail('Could not start the microphone (' + e.name + '). Close other apps using it and try again.');
    }
  }

  function stop() {
    cancelAnimationFrame(raf); raf = 0;
    if (stream) stream.getTracks().forEach((t) => t.stop());
    if (ctx) ctx.close().catch(() => {});
    if (wakeLock) wakeLock.release().catch(() => {});
    stream = ctx = analyser = wakeLock = null;
    startBtn.textContent = 'Start tuner'; startBtn.classList.remove('stop'); startBtn.disabled = false;
    levelEl.style.setProperty('--lvl', 0);
    resetPitch(); render(null);
    statusEl.textContent = 'Tap Start, then play one string';
    msg.textContent = 'Audio is analysed on this device and never uploaded.';
  }

  function fail(text) { startBtn.disabled = false; msg.textContent = text; msg.classList.add('err'); }

  function showDiag(track) {
    const s = (track && track.getSettings && track.getSettings()) || {};
    const processing = s.echoCancellation || s.noiseSuppression || s.autoGainControl;
    diag.textContent = (sr / 1000).toFixed(1) + ' kHz · ' + (track ? track.label || 'microphone' : 'microphone') +
      (processing ? ' · browser voice processing is on, readings may wobble' : ' · raw input');
  }

  async function requestWakeLock() {
    try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { /* not granted */ }
  }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && stream && !wakeLock) requestWakeLock(); });

  function resetPitch() { hist = []; stableMidi = null; pending = []; dispMidi = null; inTuneSince = 0; }

  function median(a) { const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; }

  function loop(now) {
    raf = requestAnimationFrame(loop);
    analyser.getFloatTimeDomainData(buf);
    const r = det.detect(buf, sr);
    levelEl.style.setProperty('--lvl', Math.min(1, Math.sqrt(r.rms) * 3));

    // Adaptive noise gate: learns each mic's/room's background level from frames with no pitch.
    if (r.clarity < 0.5) noiseFloor = Math.min(0.03, noiseFloor * 0.99 + r.rms * 0.01);
    const gate = Math.max(0.0012, noiseFloor * 2.5);
    const voiced = r.freq > 0 && r.clarity >= MIN_CLARITY && r.rms > gate;

    let shown = null;
    if (voiced) {
      const m = freqToMidi(r.freq, a4);
      if (stableMidi != null && Math.abs(m - stableMidi) > 0.6) {
        // Possible new note or an octave slip: only accept after a few agreeing frames.
        if (pending.length && Math.abs(m - pending[pending.length - 1]) > 0.5) pending = [];
        pending.push(m);
        if (pending.length >= 4) { hist = pending.slice(); pending = []; dispMidi = null; }
      } else {
        pending = [];
        hist.push(m); if (hist.length > 7) hist.shift();
      }
      if (hist.length) {
        stableMidi = median(hist);
        dispMidi = dispMidi == null ? stableMidi : dispMidi + 0.3 * (stableMidi - dispMidi);
        lastVoiced = now;
      }
    }
    if (dispMidi != null && now - lastVoiced < HOLD_MS) shown = dispMidi;
    else if (dispMidi != null) resetPitch();

    const fresh = shown != null && now - lastVoiced < 150;
    traceData.copyWithin(0, 1);
    traceData[TRACE_LEN - 1] = fresh ? centsFor(shown).cents : NaN;
    render(shown, fresh, now);
    drawTrace();
  }

  function centsFor(midi) {
    if (!strings.length) { const t = Math.round(midi); return { target: t, cents: (midi - t) * 100, idx: -1, label: null }; }
    let idx = locked;
    if (idx == null) {
      idx = 0;
      for (let i = 1; i < strings.length; i++) if (Math.abs(midi - strings[i]) < Math.abs(midi - strings[idx])) idx = i;
    }
    return { target: strings[idx], cents: (midi - strings[idx]) * 100, idx, label: labels[idx] };
  }

  function render(midi, fresh, now) {
    if (midi == null) {
      app.className = 'app idle';
      noteEl.textContent = '–'; centsEl.textContent = '±0'; hzEl.textContent = '—';
      needle.style.left = '50%';
      if (stream) statusEl.textContent = 'Play a string';
      markString(-1, false);
      return;
    }
    const { target, cents, idx, label } = centsFor(midi);
    const ok = Math.abs(cents) <= IN_TUNE;
    if (ok && fresh) { if (!inTuneSince) inTuneSince = now; } else inTuneSince = 0;
    const far = Math.abs(cents) > 50;
    app.className = 'app' + (ok ? ' intune' : '') + (far ? ' far' : '') + (fresh ? '' : ' idle');
    noteEl.innerHTML = noteHTML(target, label);
    const c = Math.round(cents);
    centsEl.textContent = (c > 0 ? '+' : c < 0 ? '−' : '±') + Math.abs(c);
    hzEl.textContent = midiToFreq(midi, a4).toFixed(1);
    needle.style.left = (50 + Math.max(-50, Math.min(50, cents))) + '%';
    if (ok) statusEl.textContent = inTuneSince && now - inTuneSince > 500 ? 'In tune ✓' : 'Almost there';
    else if (far && strings.length) {
      const { name, octave } = midiName(midi);
      statusEl.textContent = 'Hearing ' + name + octave + ' · tune ' + (cents < 0 ? 'up' : 'down') + ' to ' + label + midiName(target).octave;
    } else statusEl.textContent = cents < 0 ? 'Too low · tune up' : 'Too high · tune down';
    markString(idx, ok);
  }

  function markString(idx, ok) {
    if (idx === lastIdx && ok === lastOk) return;
    lastIdx = idx; lastOk = ok;
    const btns = stringsEl.querySelectorAll('button:not(.auto)');
    btns.forEach((b, i) => { b.classList.toggle('target', i === idx); b.classList.toggle('ok', i === idx && ok); });
  }

  startBtn.addEventListener('click', () => (stream ? stop() : start()));
})();
