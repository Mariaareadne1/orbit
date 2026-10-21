/**
 * The Orbit engine: one graph for live playback and offline export.
 *
 *   per voice: AudioBufferSource → Gain (voice level) → Panner (HRTF) ─┐
 *                                                                      ├→ master Gain → output
 *
 * Paths are scheduled on the panners' AudioParams ahead of time
 * (schedulePath), so motion is sample-accurate and does not depend on React
 * or the frame rate; the stage only *reads* the same interpolation to draw.
 * Looping schedules the next cycle shortly before the current one ends.
 */
import { createVoice, glideTo, placeListener, schedulePath } from './graph'
import { positionAt } from './path'
import { drone, plucks, pulse } from './signals'
import { audible, dbToGain, type OrbitDoc, type VoiceDoc } from '../state/document'
import type { StagePoint } from './coords'

export const ENGINE_RATE = 48000
export const MASTER_GAIN = 0.8
const START_LEAD = 0.06
const LOOP_LEAD = 0.25

/** Mono PCM at ENGINE_RATE for every source: built-ins generated, files decoded. */
export class SampleBank {
  private files = new Map<string, Float32Array>()
  private builtins = new Map<string, Float32Array>()

  addFile(blobId: string, mono: Float32Array) {
    this.files.set(blobId, mono)
  }

  hasFile(blobId: string) {
    return this.files.has(blobId)
  }

  samples(voice: VoiceDoc, duration: number): Float32Array | null {
    if (voice.source.kind === 'file') return this.files.get(voice.source.blobId) ?? null
    const key = `${voice.source.id}:${duration}`
    let s = this.builtins.get(key)
    if (!s) {
      const make = { drone, plucks, pulse }[voice.source.id]
      s = make(duration, ENGINE_RATE)
      this.builtins.set(key, s)
    }
    return s
  }
}

function toBuffer(ctx: BaseAudioContext, samples: Float32Array): AudioBuffer {
  const b = ctx.createBuffer(1, samples.length, ENGINE_RATE)
  b.copyToChannel(samples as Float32Array<ArrayBuffer>, 0)
  return b
}

interface ActiveVoice {
  id: string
  cycle: number
  source: AudioBufferSourceNode
  gain: GainNode
  panner: PannerNode
}

/** Build one cycle of the arrangement into `ctx` starting at context time `when`, piece offset `offset`. */
function scheduleCycle(ctx: BaseAudioContext, doc: OrbitDoc, bank: SampleBank, master: AudioNode, when: number, offset: number, cycle: number): ActiveVoice[] {
  const out: ActiveVoice[] = []
  const buffers = new Map<VoiceDoc, AudioBuffer>()
  for (const v of audible(doc.voices)) {
    const samples = bank.samples(v, doc.duration)
    if (!samples) continue
    const seconds = samples.length / ENGINE_RATE
    if (offset >= seconds) continue
    let buffer = buffers.get(v)
    if (!buffer) buffers.set(v, (buffer = toBuffer(ctx, samples)))
    const voice = createVoice(ctx, buffer, master, dbToGain(v.gainDb))
    schedulePath(voice.panner, v.path, when, offset)
    voice.source.start(when, offset)
    voice.source.stop(when + (doc.duration - offset))
    out.push({ id: v.id, cycle, ...voice })
  }
  return out
}

/** Offline render of the whole arrangement — the export path. */
export async function renderArrangement(doc: OrbitDoc, bank: SampleBank): Promise<{ left: Float32Array; right: Float32Array; sampleRate: number }> {
  const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: Math.round(doc.duration * ENGINE_RATE), sampleRate: ENGINE_RATE })
  placeListener(ctx)
  const master = new GainNode(ctx, { gain: MASTER_GAIN })
  master.connect(ctx.destination)
  scheduleCycle(ctx, doc, bank, master, 0, 0, 0)
  const out = await ctx.startRendering()
  return { left: out.getChannelData(0).slice(), right: out.getChannelData(1).slice(), sampleRate: ENGINE_RATE }
}

export class OrbitEngine {
  readonly bank = new SampleBank()
  private ctx: AudioContext | null = null
  private master: GainNode | null = null
  private doc: OrbitDoc | null = null
  private active: ActiveVoice[] = []
  private cycle = 0
  /** context time at which piece time 0 of the current cycle occurs */
  private cycleStart = 0
  private pausedAt = 0
  private loopTimer = 0
  private stopTimer = 0
  private grabbed: { id: string; point: StagePoint } | null = null
  playing = false
  onEnded: (() => void) | null = null

  /** Must be called from a user gesture the first time (autoplay policy). */
  async ensureContext(): Promise<AudioContext> {
    if (!this.ctx) {
      // Run live at the export rate: browser HRTF kernels depend on the sample
      // rate, so matching it keeps live playback and the exported WAV alike.
      try {
        this.ctx = new AudioContext({ latencyHint: 'interactive', sampleRate: ENGINE_RATE })
      } catch {
        this.ctx = new AudioContext({ latencyHint: 'interactive' })
      }
      placeListener(this.ctx)
      this.master = new GainNode(this.ctx, { gain: MASTER_GAIN })
      this.master.connect(this.ctx.destination)
    }
    if (this.ctx.state === 'suspended') await this.ctx.resume()
    return this.ctx
  }

  get context(): AudioContext | null {
    return this.ctx
  }

  get output(): GainNode | null {
    return this.master
  }

  /** Piece time corresponding to a context time in the current cycle (for measurements). */
  pieceTimeAt(contextTime: number): number {
    return contextTime - this.cycleStart
  }

  /** Current piece time in seconds. */
  time(): number {
    if (!this.playing || !this.ctx || !this.doc) return this.pausedAt
    const t = this.ctx.currentTime - this.cycleStart
    return Math.max(0, Math.min(this.doc.duration, t))
  }

  async play(doc: OrbitDoc, offset = this.pausedAt): Promise<void> {
    const ctx = await this.ensureContext()
    this.stopAll()
    this.doc = doc
    const start = offset >= doc.duration ? 0 : offset
    const when = ctx.currentTime + START_LEAD
    this.cycleStart = when - start
    this.playing = true
    this.active = scheduleCycle(ctx, doc, this.bank, this.master!, when, start, ++this.cycle)
    this.armCycleEnd()
  }

  /** Schedule the next loop cycle (or the end) shortly before this one finishes. */
  private armCycleEnd() {
    const ctx = this.ctx!
    const doc = this.doc!
    const end = this.cycleStart + doc.duration
    const msUntil = (end - LOOP_LEAD - ctx.currentTime) * 1000
    window.clearTimeout(this.loopTimer)
    window.clearTimeout(this.stopTimer)
    if (doc.loop) {
      this.loopTimer = window.setTimeout(() => {
        if (!this.playing || !this.doc) return
        const next = scheduleCycle(ctx, this.doc, this.bank, this.master!, end, 0, ++this.cycle)
        // Old-cycle nodes stop themselves at `end`; keep them until then.
        window.setTimeout(() => {
          this.active = this.active.filter((a) => a.cycle === this.cycle)
          this.cycleStart = end
          this.armCycleEnd()
        }, Math.max(0, (end - ctx.currentTime) * 1000))
        this.active.push(...next)
      }, Math.max(0, msUntil))
    } else {
      this.stopTimer = window.setTimeout(() => {
        this.stopAll()
        this.pausedAt = 0
        this.playing = false
        this.onEnded?.()
      }, Math.max(0, (end - ctx.currentTime) * 1000))
    }
  }

  pause(): void {
    this.pausedAt = this.time()
    this.stopAll()
    this.playing = false
  }

  stop(): void {
    this.stopAll()
    this.playing = false
    this.pausedAt = 0
  }

  async seek(doc: OrbitDoc, t: number): Promise<void> {
    this.pausedAt = Math.max(0, Math.min(doc.duration, t))
    if (this.playing) await this.play(doc, this.pausedAt)
    else this.doc = doc
  }

  /**
   * Apply an edited document while playing. Level changes glide; path edits
   * re-schedule from now; changes to who is audible restart the cycle in place.
   */
  update(doc: OrbitDoc): void {
    const prev = this.doc
    this.doc = doc
    if (!this.playing || !this.ctx || !prev) return
    const before = audible(prev.voices).map((v) => v.id + (v.source.kind === 'file' ? v.source.blobId : v.source.id)).join()
    const after = audible(doc.voices).map((v) => v.id + (v.source.kind === 'file' ? v.source.blobId : v.source.id)).join()
    if (before !== after || prev.duration !== doc.duration) {
      void this.play(doc, this.time())
      return
    }
    const now = this.ctx.currentTime
    const t = this.time()
    for (const a of this.active) {
      const v = doc.voices.find((x) => x.id === a.id)
      const old = prev.voices.find((x) => x.id === a.id)
      if (!v || !old) continue
      if (v.gainDb !== old.gainDb) a.gain.gain.setTargetAtTime(dbToGain(v.gainDb), now, 0.02)
      if (v.path !== old.path && this.grabbed?.id !== v.id && a.cycle === this.cycle) schedulePath(a.panner, v.path, now, t)
    }
  }

  /** Perform mode: the hand drives the panner directly while held. */
  grab(id: string, point: StagePoint): void {
    this.grabbed = { id, point }
    if (!this.ctx) return
    for (const a of this.active) if (a.id === id) {
      a.panner.positionX.cancelScheduledValues(0)
      a.panner.positionY.cancelScheduledValues(0)
      a.panner.positionZ.cancelScheduledValues(0)
      glideTo(a.panner, point, this.ctx.currentTime)
    }
  }

  release(): void {
    this.grabbed = null
  }

  /** Where a voice is right now (the grabbed position while performing). */
  position(voice: VoiceDoc, t = this.time()): StagePoint {
    if (this.grabbed?.id === voice.id) return this.grabbed.point
    return positionAt(voice.path, t)
  }

  private stopAll() {
    window.clearTimeout(this.loopTimer)
    window.clearTimeout(this.stopTimer)
    const now = this.ctx?.currentTime ?? 0
    for (const a of this.active) {
      try {
        a.source.stop(now)
      } catch {
        // already stopped
      }
      a.source.disconnect()
      a.panner.disconnect()
    }
    this.active = []
  }

  async dispose(): Promise<void> {
    this.stopAll()
    this.playing = false
    await this.ctx?.close()
    this.ctx = null
  }
}
