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

## O1 — compositional studies ✔ (DECISIONS D6)
Study A (theatre stage + six-lane score + contextual card) and B (oversized polar stage + fold-out score)
built in the app from live state, screenshotted desktop + phone (`docs/media/studies/`). Chose A; B removed.

## O2 — stage and input affordances ✔
Calibrated stage (rings 1–5 m, azimuth every 10°, cardinal labels, listener with nose + facing wedge),
shape+colour identities (legacy palette migrated), focusable sources, 22-unit hit zones, chevrons on paths,
mode tool with distinct cursors/hints. Measured: placing/dragging a sound mid-playback puts the sounding
PannerNode at `stageToAudio(point)` within 0.02 m (behind = +Z); export balance follows (+2.0 dB right,
−1.2 dB behind-left for the 110 Hz drone).

## O3 — score, transport, editor flows ✔
Score lanes + playhead slider + empty-lane add; transport with loop switch, typed length, live AnalyserNode
meter; contextual card; Perform shows ● Rec on stage and the replaced stretch on the score; announcements
via aria-live. Loop phase: consecutive cycles' balance curves differ ≤ 0.04–0.06 dB (Chromium, fake sink).
Main thread blocked 1.2 s across a loop wrap (stand-in for background-tab throttling): no gap, cycles 4.000 s apart.

## O4 — persistence, export and failure states ✔
Blocked/held audio banner with retry (also resumes on return to the tab), no-Web-Audio notice, storage-full
banner + "not saved" status that Save clears, canceled import acknowledged, export failure reported, invalid
length explained, two-step remove, two-step New, imported-audio GC verified in IndexedDB.
Independent review (subagent) found no invariant violations; fixed its findings: clock was a chattering
live region; card covered the stage on tablet/phone (now docked; opens only on deliberate picks); fast
Draw flick could drop points (points now on the gesture); impure state updaters; score curves recomputed
each frame (memoised); Place arrow key could flatten a moving path (now refused with a hint; held keys = one
undo step); resume timer not cleared; repeated announcements swallowed. Also found by tests: a fast tap in
Place committed the pre-preview path (fixed).

### Environment (2026-10-26)
After the baseline run the Mac's real output clock stalled again: on about:blank a running AudioContext
advanced 0.006 s (Chromium) and 0 s (WebKit) in 0.8 s; Chromium's fake sink advanced 0.72 s. Not changed:
OS audio. So real-time results after O0 are **Chromium fake-sink** (36/36 pass); WebKit was run for every
test that doesn't need a moving clock (21 pass, 2 skipped by design) — its real-time tests fail only for the
stalled clock. Homebrew's ffprobe is also broken here (missing libx265 dylib); `ffprobe-static` (dev dep)
is used instead. Nothing here was listened to on hardware.

DSP fixtures (offline, `tests/e2e/dsp.spec.ts`), Chromium / WebKit, balance R−L:
noise ±2 m side −4.47/+4.42 | −5.37/+5.40 dB; 1 kHz sine side −6.43/+6.58 | −8.49/+8.35 dB;
1 m vs 4 m ahead −12.0 dB (model −12.04); peaks ≤ 0.33, 0 clipped; every WAV decoded by python `wave`
and ffprobe as pcm_s16le / 48 kHz / 2 ch / 4.000 s.

## O5 — verification and ship ✔ (2026-10-26)
- Local: typecheck ✔ · lint ✔ · unit 14/14 ✔ · build ✔ · E2E Chromium (fake sink) 36/36 ✔ ·
  E2E WebKit (real device, clock stalled) 21/21 clock-independent tests ✔, 2 skipped by design.
- Measured: live vs export balance max 0.06 dB (Chromium, fake sink; baseline 0.04 dB real device);
  loop cycle vs cycle 0.04–0.06 dB.
- Merged `redesign/spatial-theatre` → `main` (fast-forward, `cbbe2e4`); GitHub Actions run 40276179834:
  build ✔, Linux Chromium E2E ✔, Pages deploy ✔.
- Production https://mariaareadne1.github.io/orbit/ checked with Playwright: new UI and assets load under
  /orbit/ with no 4xx or console errors, playback clock runs (fake sink), phone has no horizontal scroll,
  exported WAV decoded by python `wave` + ffprobe: pcm_s16le, 48 kHz, 2 ch, 16.000 s, peak −8.2 dBFS, 0 clipped.

## Remaining
- Re-run the real-time E2E in WebKit (and Chromium without the fake sink) once this Mac's audio output
  clock advances again; listen to an export on headphones.
- Real iPhone/iPad: audio unlock, background/resume and touch were tested only in emulation.
- Firefox untested. No elevation (sources at ear height); generic browser HRTF, weak front/back cues.
