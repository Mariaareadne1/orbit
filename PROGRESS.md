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
