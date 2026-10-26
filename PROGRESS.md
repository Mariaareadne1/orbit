# Orbit — progress

- Repo: https://github.com/Mariaareadne1/orbit · Live: https://mariaareadne1.github.io/orbit/

- [x] O0 coordinate system, signals generated in code, HRTF graph, listener orientation (with legacy WebKit fallback)
- [x] O1 measured proof in Chromium + WebKit; WAV validated with python `wave` and ffprobe
- [x] O2 editor: up to six voices (built-in or imported audio), Place / Draw / Perform tools, presets,
      timeline lanes, mute/solo/level, undo/redo, autosave with imported audio in IndexedDB
- [x] O3 AudioParam-scheduled playback, seek, loop scheduled ahead; live runs at 48 kHz like export
- [x] O4 offline WAV export of the arrangement; live vs export balance within 0.06 dB (tested)
- [x] O5 visual pass, phone layout, a11y basics (keyboard nudge, slider playhead, labelled controls), deploy

Tests (2026-10-21): 14 unit · 25 E2E. After a macOS restart the machine's audio output stopped advancing
the AudioContext clock in both browsers (a bare AudioContext on about:blank measured 0 s of progress in
0.8 s), so real-time tests were re-verified in Chromium with its fake audio sink:
`ORBIT_FAKE_AUDIO=1 pnpm test:e2e --project=chromium` (all pass; loop tests wait on the audio clock).
CI runs the suite on Linux.

## Independent review (2026-10-21) — fixed
Untracked loop timer could corrupt the clock after pause/seek; Loop toggle mid-play ignored; path edits
near a cycle boundary broke the next cycle; a Perform click without movement left the panner stuck;
background-tab throttling vs a 250 ms loop lead → replaced with a look-ahead scheduler (1.5 s, play
generation token, tracked cycles, future-cycle cancellation). Also: recording anchors (no drift before a
recording), redraw on paused seek, undo-to-initial is saved, orphaned audio files cleaned at boot,
IndexedDB abort no longer hangs imports, Length field editable, flush on pagehide, cached AudioBuffers.

## Known gaps
- No elevation (sources at ear height); HRTF is the browser's generic set — front/back cues are weak.
- Perform recording stops at a loop wrap (it keeps what was recorded).
- Firefox and real touch devices not tested; mobile Safari audio unlocking not verified on hardware.
- Editing a path while it plays reschedules from "now"; a drag in Place mode during playback is heard live.

---

# Redesign — Spatial Sound Theatre (branch `redesign/spatial-theatre`)

Resume here: each milestone below is ticked only after its checks ran. Baseline commit `d359749`.

## O0 — evidence-first audit (2026-10-25) ✔
- Clone: `~/Developer/design-engineering-build-2026/orbit`, `origin` = github.com/Mariaareadne1/orbit, `main` clean
  and level with `origin/main` before branching. Pages deploys only from pushes to `main` (`.github/workflows/pages.yml`).
- Dependency graph (from code): `App` → `useOrbit` (history reducer, autosave to localStorage `orbit.document.v1`,
  IndexedDB `orbit/files` for imported bytes, boot-time orphan GC) → `OrbitEngine` (one AudioContext at 48 kHz,
  per-cycle `AudioBufferSource → Gain → Panner(HRTF) → master Gain`, look-ahead loop scheduler 1.5 s / 100 ms tick,
  generation token, grab/release for Perform). `Stage` draws `engine.position()` = `positionAt(path, engine.time())`,
  the same interpolation `schedulePath` writes with `linearRampToValueAtTime`. Export = `renderArrangement` (same
  `scheduleCycle`, OfflineAudioContext 48 kHz) → `encodeWav` 16-bit. Geometry in `src/audio/coords.ts`
  (stage (x,y) → audio (x,0,−y), listener faces −Z) — verified in code and unit tests.
- Machine audio: this time the real output device **does** advance the AudioContext clock in both Playwright
  browsers, so the baseline below is real-device playback (headless; not listened to).
- Baseline checks: `pnpm typecheck` ✔ · `pnpm lint` ✔ · `pnpm test` 14/14 ✔ · `pnpm build` ✔ ·
  `pnpm test:e2e` 30 passed, 2 skipped by design (file checks run once, in Chromium).
- Baseline audio: live vs export balance, 0.5 s windows over an 8 s L→R pass: max |Δ| **0.04 dB** (Chromium 156),
  **0.05 dB** (WebKit 27.2). Proof sweep crossing 3.03 s / 3.02 s; distance 1 m vs 4 m −12.04 dB (model −12.04);
  peak 0.40, 0 clipped. Sweep WAV: python `wave` 2 ch / 48 kHz / 6.000 s; ffprobe `pcm_s16le`.
- Before screenshots: `docs/media/before/`.
