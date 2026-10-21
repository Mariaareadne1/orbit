import { stageToAudio, type StagePoint } from './coords'
import { positionAt, remaining, type Keyframe } from './path'

/** Panner settings shared by live playback and offline rendering. */
export const PANNER = {
  panningModel: 'HRTF',
  distanceModel: 'inverse',
  refDistance: 1,
  maxDistance: 40,
  rolloffFactor: 1,
  coneInnerAngle: 360,
  coneOuterAngle: 360,
  coneOuterGain: 1,
} as const satisfies PannerOptions

/** Listener at the origin, facing −Z, +Y up (see coords.ts). */
export function placeListener(ctx: BaseAudioContext): void {
  const l = ctx.listener
  if (l.positionX) {
    l.positionX.value = 0
    l.positionY.value = 0
    l.positionZ.value = 0
    l.forwardX.value = 0
    l.forwardY.value = 0
    l.forwardZ.value = -1
    l.upX.value = 0
    l.upY.value = 1
    l.upZ.value = 0
  } else {
    // Older WebKit: the deprecated setters are the only way.
    const legacy = l as unknown as { setPosition(x: number, y: number, z: number): void; setOrientation(...v: number[]): void }
    legacy.setPosition(0, 0, 0)
    legacy.setOrientation(0, 0, -1, 0, 1, 0)
  }
}

export interface Voice {
  source: AudioBufferSourceNode
  gain: GainNode
  panner: PannerNode
}

export function createVoice(ctx: BaseAudioContext, buffer: AudioBuffer, destination: AudioNode, gain = 1, loop = false): Voice {
  const source = new AudioBufferSourceNode(ctx, { buffer, loop })
  const g = new GainNode(ctx, { gain })
  const panner = new PannerNode(ctx, PANNER)
  source.connect(g).connect(panner).connect(destination)
  return { source, gain: g, panner }
}

/** Jump the panner to a point now. */
export function setPosition(panner: PannerNode, p: StagePoint, at: number): void {
  const a = stageToAudio(p)
  panner.positionX.setValueAtTime(a.x, at)
  panner.positionY.setValueAtTime(a.y, at)
  panner.positionZ.setValueAtTime(a.z, at)
}

/** Glide toward a point (live dragging): a short exponential approach, no zipper noise. */
export function glideTo(panner: PannerNode, p: StagePoint, now: number, timeConstant = 0.03): void {
  const a = stageToAudio(p)
  panner.positionX.setTargetAtTime(a.x, now, timeConstant)
  panner.positionY.setTargetAtTime(a.y, now, timeConstant)
  panner.positionZ.setTargetAtTime(a.z, now, timeConstant)
}

/**
 * Schedule a path on a panner. `startAt` is the context time that corresponds
 * to `offset` seconds into the piece; segments already in the past are
 * replaced by the interpolated position at `offset`, so seeking is exact.
 */
export function schedulePath(panner: PannerNode, path: readonly Keyframe[], startAt: number, offset = 0): void {
  const params = [panner.positionX, panner.positionY, panner.positionZ]
  for (const p of params) p.cancelScheduledValues(0)
  setPosition(panner, positionAt(path, offset), startAt)
  for (const k of remaining(path, offset)) {
    const a = stageToAudio(k)
    const when = startAt + (k.t - offset)
    panner.positionX.linearRampToValueAtTime(a.x, when)
    panner.positionY.linearRampToValueAtTime(a.y, when)
    panner.positionZ.linearRampToValueAtTime(a.z, when)
  }
}
