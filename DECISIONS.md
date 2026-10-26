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

## D6 — Composition: theatre stage + always-visible score (study A), not a fold-out score (study B)
Both studies were built in the app on this branch from live state (same document, playing then paused at
~2.6 s, Plucks selected) and screenshotted at 1440×900 and 390×844 (`docs/media/studies/`); B was then removed.
B's oversized polar stage reached ≈690 px at 1440×900 against A's ≈560 px, but it folds the
choreography score away: the direction lanes, the playhead and Perform's recording region are what tie a
gesture to time, and hiding them made Draw/Perform harder to read and put the inset over the stage's
back half on shorter screens. A keeps one dominant stage between two quiet rails (mode tool + listening
legend on the left, the selected sound's card on the right) and a compact six-lane score below. From B
we kept the lesson that the score must stay slim: 24 px lanes, one control bar. On a 16:10 desktop the
circle is bounded by height, so the *stage field* (lit area between the rails) is ~58% of the width, not
the circle itself; the geometry stays uniformly scaled (a true circle) rather than stretching to fill.

## D7 — Identity beyond hue; light that never means loudness
Each palette slot pairs a muted colour with a shape (circle, square, triangle, diamond, hexagon, cross)
used on the stage marker, the lane head and the card, so voices survive greyscale and colour blindness.
Old documents' neon colours map to the new palette by index. Stage lighting is a fixed radial gradient;
markers have no glow. The only level display is the transport meter, read from AnalyserNodes on the
live master (a parallel tap with no output, so the heard and exported signal are unchanged).

## D8 — Contextual card instead of a permanent inspector
Selecting a sound (stage, lane name, or keys 1–6) opens one card beside the stage with its origin, live
coordinates, level, mute/solo, motion presets, replace and a two-step remove. Closing it keeps the
selection, so the mode tools still act on that sound. Default mode is Place: a press on a source in
Place only moves it after 4 px of travel, so clicking a moving sound to inspect it never flattens its path.
