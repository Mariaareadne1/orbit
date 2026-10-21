"""Independent check of an Orbit WAV: header fields and channel energy over time.

Usage: python3 -I scripts/check_wav.py file.wav
Prints JSON. Uses only the standard library (wave, struct, math).
"""
import json
import math
import struct
import sys
import wave

path = sys.argv[1]
with wave.open(path, "rb") as w:
    ch, width, rate, frames = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
    raw = w.readframes(frames)

samples = struct.unpack("<%dh" % (frames * ch), raw)
left = samples[0::ch]
right = samples[1::ch] if ch > 1 else left


def rms(xs):
    return math.sqrt(sum(x * x for x in xs) / max(1, len(xs))) / 32768.0


def seg(xs, a, b):
    return xs[int(a * rate):int(b * rate)]


dur = frames / rate
first = 20 * math.log10(rms(seg(right, 0, 1)) / rms(seg(left, 0, 1)))
last = 20 * math.log10(rms(seg(right, dur - 1, dur)) / rms(seg(left, dur - 1, dur)))
peak = max(abs(x) for x in samples) / 32768.0
print(json.dumps({"channels": ch, "sampleWidth": width, "sampleRate": rate, "frames": frames,
                  "durationSeconds": dur, "firstSecondBalanceDb": first, "lastSecondBalanceDb": last, "peak": peak}))
