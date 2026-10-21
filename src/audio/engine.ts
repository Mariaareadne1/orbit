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
/** Schedule loop cycles this far ahead; survives background-tab timer throttling (≥ 1 s). */
const LOOKAHEAD = 1.5
const TICK_MS = 100

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

/** AudioBuffers per context, cached per sample array so seeks and loops don't re-copy audio. */
const bufferCache = new WeakMap<BaseAudioContext, WeakMap<Float32Array, AudioBuffer>>()

function toBuffer(ctx: BaseAudioContext, samples: Float32Array): AudioBuffer {
  let cache = bufferCache.get(ctx)
  if (!cache) bufferCache.set(ctx, (cache = new WeakMap()))
  let b = cache.get(samples)
  if (!b) {
    b = ctx.createBuffer(1, samples.length, ENGINE_RATE)
    b.copyToChannel(samples as Float32Array<ArrayBuffer>, 0)
    cache.set(samples, b)
  }
  return b
}

interface ActiveVoice {
  id: string
  /** the cycle this node plays in */
  cycle: number
  source: AudioBufferSourceNode
  gain: GainNode
  panner: PannerNode
}

/** Build one cycle of the arrangement into `ctx` starting at context time `when`, piece offset `offset`. */
function scheduleCycle(ctx: BaseAudioContext, doc: OrbitDoc, bank: SampleBank, master: AudioNode, when: number, offset: number, cycle: number): ActiveVoice[] {
  const out: ActiveVoice[] = []
  for (const v of audible(doc.voices)) {
    const samples = bank.samples(v, doc.duration)
    if (!samples) continue
    const seconds = samples.length / ENGINE_RATE
    if (offset >= seconds) continue
    const voice = createVoice(ctx, toBuffer(ctx, samples), master, dbToGain(v.gainDb))
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
  /** scheduled cycles: index → context time at which piece time 0 occurs */
  private cycles = new Map<number, number>()
  private nextCycle = 0
  /** start times of every cycle since the last play(), kept after playback ends (measurements) */
  private starts: number[] = []
  private pausedAt = 0
  private ticker = 0
  /** bumped by every play/stop so stale async work can tell it is stale */
  private generation = 0
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

  /** The cycle sounding now: the latest one that has started. */
  private currentCycle(): { index: number; start: number } | null {
    if (!this.ctx) return null
    const now = this.ctx.currentTime
    let best: { index: number; start: number } | null = null
    for (const [index, start] of this.cycles) {
      if (start <= now + 1e-6 && (!best || start > best.start)) best = { index, start }
    }
    if (!best) for (const [index, start] of this.cycles) if (!best || start < best.start) best = { index, start }
    return best
  }

  /** Piece time corresponding to a context time in the current cycle (for measurements). */
  pieceTimeAt(contextTime: number): number {
    let start = this.starts[0] ?? 0
    for (const s of this.starts) if (s <= contextTime + 1e-9) start = s
    return contextTime - start
  }

  /** Current piece time in seconds. */
  time(): number {
    if (!this.playing || !this.ctx || !this.doc) return this.pausedAt
    const c = this.currentCycle()
    return c ? Math.max(0, Math.min(this.doc.duration, this.ctx.currentTime - c.start)) : this.pausedAt
  }

  async play(doc: OrbitDoc, offset = this.pausedAt): Promise<void> {
    const gen = ++this.generation
    const ctx = await this.ensureContext()
    if (gen !== this.generation) return // a pause/stop/seek happened while the context started
    this.stopAll()
    this.doc = doc
    const start = offset >= doc.duration ? 0 : offset
    const when = ctx.currentTime + START_LEAD
    const index = this.nextCycle++
    this.cycles.set(index, when - start)
    this.starts = [when - start]
    this.active = scheduleCycle(ctx, doc, this.bank, this.master!, when, start, index)
    this.playing = true
    this.tick()
    this.ticker = window.setInterval(() => this.tick(), TICK_MS)
  }

  /**
   * Look-ahead scheduler: keeps the next loop cycle scheduled ≥ LOOKAHEAD
   * seconds before it starts, ends non-looping playback, and forgets
   * finished cycles. Reads the live document, so toggling Loop takes effect.
   */
  private tick() {
    if (!this.playing || !this.ctx || !this.doc) return
    const now = this.ctx.currentTime
    const doc = this.doc
    const last = Math.max(...this.cycles.keys())
    const lastStart = this.cycles.get(last)!
    const end = lastStart + doc.duration
    if (doc.loop) {
      if (end - now < LOOKAHEAD) {
        const index = this.nextCycle++
        this.cycles.set(index, end)
        this.starts.push(end)
        this.active.push(...scheduleCycle(this.ctx, doc, this.bank, this.master!, end, 0, index))
      }
    } else if (now >= end) {
      this.stopAll()
      this.playing = false
      this.pausedAt = 0
      this.onEnded?.()
      return
    }
    // Drop cycles (and their nodes' bookkeeping) that have finished.
    for (const [index, start] of this.cycles) {
      if (start + doc.duration < now - 0.5 && this.cycles.size > 1) {
        this.cycles.delete(index)
        this.active = this.active.filter((a) => a.cycle !== index)
      }
    }
  }

  /** Cancel cycles that have been scheduled but not started (Loop turned off, edits). */
  private cancelFutureCycles() {
    if (!this.ctx) return
    const now = this.ctx.currentTime
    for (const [index, start] of [...this.cycles]) {
      if (start > now + 0.01 && this.cycles.size > 1) {
        this.cycles.delete(index)
        for (const a of this.active.filter((x) => x.cycle === index)) stopVoice(a, now)
        this.active = this.active.filter((x) => x.cycle !== index)
      }
    }
  }

  pause(): void {
    this.pausedAt = this.time()
    this.generation++
    this.stopAll()
    this.playing = false
  }

  stop(): void {
    this.generation++
    this.stopAll()
    this.playing = false
    this.pausedAt = 0
  }

  async seek(doc: OrbitDoc, t: number): Promise<void> {
    this.pausedAt = Math.max(0, Math.min(doc.duration, t))
    this.doc = doc
    if (this.playing) await this.play(doc, this.pausedAt)
  }

  /**
   * Apply an edited document while playing. Level changes glide; path edits
   * re-schedule the sounding cycle from now and rebuild any cycle scheduled
   * ahead; changes to who is audible or to the length restart in place.
   */
  update(doc: OrbitDoc): void {
    const prev = this.doc
    this.doc = doc
    if (!this.playing || !this.ctx || !prev) return
    const sig = (d: OrbitDoc) => audible(d.voices).map((v) => v.id + (v.source.kind === 'file' ? v.source.blobId : v.source.id)).join()
    if (sig(prev) !== sig(doc) || prev.duration !== doc.duration) {
      void this.play(doc, this.time())
      return
    }
    const pathsChanged = doc.voices.some((v) => prev.voices.find((x) => x.id === v.id)?.path !== v.path)
    if (prev.loop !== doc.loop || pathsChanged) {
      // Future cycles were built from the old document; the ticker rebuilds them.
      this.cancelFutureCycles()
      this.tick()
    }
    const now = this.ctx.currentTime
    const t = this.time()
    const current = this.currentCycle()
    for (const a of this.active) {
      const v = doc.voices.find((x) => x.id === a.id)
      const old = prev.voices.find((x) => x.id === a.id)
      if (!v || !old) continue
      if (v.gainDb !== old.gainDb) a.gain.gain.setTargetAtTime(dbToGain(v.gainDb), now, 0.02)
      if (v.path !== old.path && this.grabbed?.id !== v.id && a.cycle === current?.index) schedulePath(a.panner, v.path, now, t)
    }
  }

  /** Perform mode: the hand drives the panner directly while held. */
  grab(id: string, point: StagePoint): void {
    this.grabbed = { id, point }
    if (!this.ctx) return
    const current = this.currentCycle()
    for (const a of this.active) if (a.id === id && a.cycle === current?.index) {
      a.panner.positionX.cancelScheduledValues(0)
      a.panner.positionY.cancelScheduledValues(0)
      a.panner.positionZ.cancelScheduledValues(0)
      glideTo(a.panner, point, this.ctx.currentTime)
    }
  }

  /** End a grab: the voice returns to its (possibly just-edited) path from now. */
  release(): void {
    const id = this.grabbed?.id
    this.grabbed = null
    if (!id || !this.ctx || !this.doc || !this.playing) return
    const v = this.doc.voices.find((x) => x.id === id)
    const current = this.currentCycle()
    if (!v) return
    for (const a of this.active) if (a.id === id && a.cycle === current?.index) schedulePath(a.panner, v.path, this.ctx.currentTime, this.time())
  }

  /** Where a voice is right now (the grabbed position while performing). */
  position(voice: VoiceDoc, t = this.time()): StagePoint {
    if (this.grabbed?.id === voice.id) return this.grabbed.point
    return positionAt(voice.path, t)
  }

  private stopAll() {
    window.clearInterval(this.ticker)
    const now = this.ctx?.currentTime ?? 0
    for (const a of this.active) stopVoice(a, now)
    this.active = []
    this.cycles.clear()
  }

  async dispose(): Promise<void> {
    this.generation++
    this.stopAll()
    this.playing = false
    await this.ctx?.close()
    this.ctx = null
  }
}

function stopVoice(a: ActiveVoice, at: number) {
  try {
    a.source.stop(at)
  } catch {
    // already stopped
  }
  a.source.disconnect()
  a.panner.disconnect()
}
