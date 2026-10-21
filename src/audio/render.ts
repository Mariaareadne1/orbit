/**
 * Offline renders through the same graph live playback uses. These are the
 * evidence that stage positions change the actual signal.
 */
import { createVoice, placeListener, schedulePath, setPosition } from './graph'
import type { Keyframe } from './path'
import type { StagePoint } from './coords'

export const RENDER_RATE = 48000

export interface Rendered {
  sampleRate: number
  left: Float32Array
  right: Float32Array
}

async function renderVoice(signal: Float32Array, seconds: number, place: (p: PannerNode) => void, sampleRate = RENDER_RATE): Promise<Rendered> {
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: Math.round(seconds * sampleRate), sampleRate })
  placeListener(ctx)
  const buffer = ctx.createBuffer(1, signal.length, sampleRate)
  buffer.copyToChannel(signal as Float32Array<ArrayBuffer>, 0)
  const voice = createVoice(ctx, buffer, ctx.destination)
  place(voice.panner)
  voice.source.start(0)
  const out = await ctx.startRendering()
  return { sampleRate, left: out.getChannelData(0).slice(), right: out.getChannelData(1).slice() }
}

/** A source moving along `path` (stage metres) for `seconds`. */
export function renderPath(signal: Float32Array, path: readonly Keyframe[], seconds: number, sampleRate = RENDER_RATE): Promise<Rendered> {
  return renderVoice(signal, seconds, (p) => schedulePath(p, path, 0, 0), sampleRate)
}

/** A stationary source at `point`. */
export function renderStatic(signal: Float32Array, point: StagePoint, seconds: number, sampleRate = RENDER_RATE): Promise<Rendered> {
  return renderVoice(signal, seconds, (p) => setPosition(p, point, 0), sampleRate)
}
