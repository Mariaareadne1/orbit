# Orbit — progress

- Repo: https://github.com/Mariaareadne1/orbit · Live: https://mariaareadne1.github.io/orbit/

- [x] O0 coordinate system, signals generated in code, HRTF graph, listener orientation (with legacy WebKit fallback)
- [x] O1 measured proof in Chromium + WebKit; WAV validated with python `wave` and ffprobe
- [x] O2 editor: up to six voices (built-in or imported audio), Place / Draw / Perform tools, presets,
      timeline lanes, mute/solo/level, undo/redo, autosave with imported audio in IndexedDB
- [x] O3 AudioParam-scheduled playback, seek, loop scheduled ahead; live runs at 48 kHz like export
- [x] O4 offline WAV export of the arrangement; live vs export balance within 0.06 dB (tested)
- [x] O5 visual pass, phone layout, a11y basics (keyboard nudge, slider playhead, labelled controls), deploy

Tests (2026-10-21): 11 unit · 20 E2E (Chromium + WebKit; 2 file checks run in Chromium only).

## Known gaps
- No elevation (sources at ear height); HRTF is the browser's generic set — front/back cues are weak.
- Perform recording stops at a loop wrap (it keeps what was recorded).
- Firefox and real touch devices not tested; mobile Safari audio unlocking not verified on hardware.
- Editing a path while it plays reschedules from "now"; a drag in Place mode during playback is heard live.
