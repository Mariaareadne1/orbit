# Decisions

## D1 — Web Audio's PannerNode, not Tone.js
Tone.js (MIT) wraps the same PannerNode; its Transport would add a second clock to keep in sync. The
engine needs only buffer sources, gains, panners and AudioParam automation, so it uses Web Audio
directly (~250 lines) and keeps one clock: the AudioContext's. wavesurfer.js was not needed: lanes plot
direction, not waveforms.

## D2 — Schedule motion on AudioParams; draw from the same function
Paths are piecewise-linear keyframes. `schedulePath` writes `setValueAtTime` + `linearRampToValueAtTime`
for every keyframe from the current offset, and the stage draws `positionAt(path, engine.time())`, the
same interpolation. React never sits in the audio loop.

## D3 — Match the live sample rate to the export
Measured: with the live context at the device rate (44.1 kHz) and export at 48 kHz, balance differed by
~0.4 dB on a drone, because HRTF kernels are sample-rate dependent. Requesting 48 kHz live (with a
fallback) brought live/export agreement to 0.06 dB.

## D4 — Mono sources
A point source is mono; feeding stereo into a PannerNode pans the pair, which smears position. Imported
files are mixed to mono at decode.

## D5 — Perform mode bypasses the schedule while held
While a voice is grabbed its panner glides to the pointer (`setTargetAtTime`, 30 ms) with scheduled
values cancelled; on release the recorded keyframes are merged into the path and rescheduled from now.
