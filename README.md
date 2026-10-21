# Orbit

**Spatial audio choreography.** Move sounds around a listener on a top-down soundstage; their positions drive real Web Audio HRTF panning, and the arrangement renders offline to a WAV that pans the way playback did.

![Orbit: three voices around the listener, one following a drawn figure-eight](docs/media/orbit-figure-eight.jpg)

**Live:** https://mariaareadne1.github.io/orbit/ · use headphones · MIT

## What it does

- **A soundstage, not a mixer.** The listener sits at the centre facing up the screen; rings mark metres, the edge marks direction. Up to six voices: three built-in sounds generated in code (drone, plucks, pulse) or your own audio files (WAV/MP3/M4A/OGG/FLAC, decoded locally, mixed to mono, never uploaded).
- **Three ways to move a voice.** *Place* drags it to a fixed spot (arrow keys nudge it). *Draw* sketches a path that is spread evenly across the piece. *Perform* records your hand live while the music plays — the audio follows you as you move and the recording replaces that stretch of the path. Presets for orbits and passes.
- **A timeline of direction.** Each lane plots where its voice is heading over time (centre = ahead). Play, pause, seek, loop, change the length; mute, solo and level per voice; undo and redo; autosave (imported audio kept in IndexedDB).
- **Export WAV.** The same graph rendered offline at 48 kHz, 16-bit stereo, with peak level and any clipping reported.

## How it stays honest

Positions are scheduled on each `PannerNode`'s AudioParams ahead of time with `linearRampToValueAtTime`, so motion is sample-accurate and independent of the frame rate; the stage only *reads* the same interpolation to draw. Loops are scheduled a quarter-second before each cycle ends. Live playback runs at 48 kHz like the export because browser HRTF kernels depend on the sample rate — before that change, live and exported panning differed by about 0.4 dB.

**Live vs export, measured:** a test taps the live master output with an AudioWorklet during real-time playback of a left-to-right pass, renders the same arrangement offline, and compares left/right balance in half-second windows: the largest difference is **0.06 dB** in Chromium and **0.05 dB** in WebKit.

> The sections below document the DSP proof the editor is built on.

## Conventions

The listener sits at the origin facing −Z with +Y up, so +X is to the right and −Z straight ahead (Web Audio's right-handed space). The stage is a top-down view in metres: `x` right, `y` forward (up on screen); stage `(x, y)` maps to audio `(x, 0, −y)`. Azimuth is 0° ahead, +90° right, 180° behind. Sources stay at ear height. All of this lives in [`src/audio/coords.ts`](src/audio/coords.ts) and is unit-tested.

Panner: `HRTF`, `inverse` distance model, reference distance 1 m, rolloff 1, omnidirectional cones. Paths are piecewise-linear keyframes scheduled with `linearRampToValueAtTime`; the stage draws positions from the same interpolation function.

## The proof

`src/audio/proof.ts` renders licence-free signals generated in code (seeded pink noise) through the same graph as playback, in an `OfflineAudioContext` at 48 kHz, and measures the output. Measured on 2026-10-21 (Playwright's Chromium 156 and WebKit 27.2 on macOS):

| Measurement | Chromium | WebKit | What it shows |
| --- | --- | --- | --- |
| Sweep (−4, 1) → (4, 1) m over 6 s: mean L/R balance, first / middle / last third | −4.6 / −0.1 / +4.8 dB | −5.3 / −0.1 / +5.4 dB | Moving the source moves the image; the centre crossing lands at 3.03 s / 3.02 s |
| Hard left / right at 2 m, broadband | −4.4 / +4.4 dB | −5.3 / +5.3 dB | Pink noise is low-frequency heavy, where level differences between ears are small |
| Hard left / right, above 2 kHz | −15.1 / +14.7 dB | −17.0 / +17.1 dB | Head shadowing at high frequencies, as HRTF should produce |
| 1 m vs 4 m straight ahead | −12.04 dB | −12.04 dB | Matches the inverse distance model (−12.04 dB) |
| Full orbit at 2 m: balance at ¼ and ¾ turn | +4.6 / −4.6 dB | +5.2 / −5.1 dB | Right then left, as the path says |
| Ahead vs behind at 2 m, share of energy above 4 kHz | −10.4 vs −13.4 dB | −10.0 vs −13.3 dB | Behind is darker in both engines — reported, not claimed as convincing front/back localisation |
| Peak / clipped samples | 0.40 / 0 | — / 0 | No clipping |

The sweep is also encoded to 16-bit WAV in the page and checked outside the browser: Python's `wave` module reads 2 channels, 48 kHz, 6.000 s, first-second balance −4.79 dB, last-second +4.83 dB; `ffprobe` reports `pcm_s16le`, 48000 Hz, 2 channels, 6.000 s.

**Limits, plainly:** browser HRTF datasets differ by engine and are not personalised, so front/back and elevation cues are weak for many listeners; spatial effects need headphones; nothing here promises "8D" immersion. Firefox was not tested.

## Run

```bash
pnpm install
pnpm test        # unit: coordinates, paths, analysis, WAV
pnpm test:e2e    # browser: the proof and the editor in Chromium and WebKit (20 tests): live vs export
                 # parity, path tools, perform recording, looping, mute/solo in exports, import + reload,
                 # corrupt-save recovery, phone layout; WAVs checked with python + ffprobe
pnpm dev         # http://localhost:5431
```
