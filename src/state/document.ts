import type { Keyframe } from '../audio/path'
import { orbitPath } from '../audio/path'

export const SCHEMA_VERSION = 1
export const STAGE_RADIUS = 5
export const MAX_VOICES = 6
export const DURATION_LIMITS = { min: 4, max: 180 } as const
export const GAIN_LIMITS_DB = { min: -36, max: 6 } as const

export type BuiltinId = 'drone' | 'plucks' | 'pulse'
export const BUILTINS: Record<BuiltinId, string> = { drone: 'Drone', plucks: 'Plucks', pulse: 'Pulse' }

export type VoiceSource = { kind: 'builtin'; id: BuiltinId } | { kind: 'file'; blobId: string; name: string; seconds: number }

export interface VoiceDoc {
  id: string
  name: string
  color: string
  source: VoiceSource
  gainDb: number
  mute: boolean
  solo: boolean
  /** keyframes in stage metres; one keyframe = a static source */
  path: Keyframe[]
}

export interface OrbitDoc {
  version: typeof SCHEMA_VERSION
  name: string
  duration: number
  loop: boolean
  voices: VoiceDoc[]
}

export const COLORS = ['#5ee7ff', '#ffb86b', '#b18cff', '#7cf2b0', '#ff7aa8', '#f5e663']

export const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `v-${Math.random().toString(36).slice(2)}`)

export function defaultDoc(): OrbitDoc {
  const duration = 16
  return {
    version: SCHEMA_VERSION,
    name: 'First orbit',
    duration,
    loop: true,
    voices: [
      { id: newId(), name: 'Drone', color: COLORS[0]!, source: { kind: 'builtin', id: 'drone' }, gainDb: -6, mute: false, solo: false, path: [{ t: 0, x: 0, y: 2.5 }] },
      { id: newId(), name: 'Plucks', color: COLORS[1]!, source: { kind: 'builtin', id: 'plucks' }, gainDb: -3, mute: false, solo: false, path: orbitPath(2.2, duration, 1, -90, 48) },
      { id: newId(), name: 'Pulse', color: COLORS[2]!, source: { kind: 'builtin', id: 'pulse' }, gainDb: -6, mute: false, solo: false, path: [{ t: 0, x: -3.5, y: -1 }, { t: duration / 2, x: 3.5, y: -1 }, { t: duration, x: -3.5, y: -1 }] },
    ],
  }
}

/** Which voices are heard: solo wins over mute. */
export function audible(voices: readonly VoiceDoc[]): VoiceDoc[] {
  const anySolo = voices.some((v) => v.solo)
  return voices.filter((v) => (anySolo ? v.solo : !v.mute))
}

export const dbToGain = (db: number) => Math.pow(10, db / 20)

// ── validation ─────────────────────────────────────────────────────────────

export class SchemaError extends Error {}
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const num = (v: unknown, path: string, min: number, max: number) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new SchemaError(`${path} must be a number`)
  return Math.min(max, Math.max(min, v))
}
export const cleanName = (v: unknown, fallback: string) => {
  // eslint-disable-next-line no-control-regex
  const s = (typeof v === 'string' ? v : '').replace(/[\u0000-\u001f\u007f\u2028\u2029<>]/g, '').trim().slice(0, 40)
  return s || fallback
}

function readPath(v: unknown, path: string, duration: number): Keyframe[] {
  if (!Array.isArray(v) || v.length === 0 || v.length > 4000) throw new SchemaError(`${path} must be 1–4000 keyframes`)
  const out = v.map((k, i) => {
    if (!isRecord(k)) throw new SchemaError(`${path}[${i}] must be an object`)
    return {
      t: num(k.t, `${path}[${i}].t`, 0, duration),
      x: num(k.x, `${path}[${i}].x`, -STAGE_RADIUS, STAGE_RADIUS),
      y: num(k.y, `${path}[${i}].y`, -STAGE_RADIUS, STAGE_RADIUS),
    }
  })
  return out.sort((a, b) => a.t - b.t)
}

export function parseDoc(raw: unknown): OrbitDoc {
  if (!isRecord(raw)) throw new SchemaError('document must be an object')
  if (raw.version !== SCHEMA_VERSION) throw new SchemaError(`unsupported document version ${String(raw.version)}`)
  const duration = num(raw.duration, 'duration', DURATION_LIMITS.min, DURATION_LIMITS.max)
  if (!Array.isArray(raw.voices) || raw.voices.length > MAX_VOICES) throw new SchemaError(`voices must be a list of at most ${MAX_VOICES}`)
  const voices = raw.voices.map((v, i): VoiceDoc => {
    if (!isRecord(v) || !isRecord(v.source)) throw new SchemaError(`voices[${i}] is malformed`)
    const s = v.source
    let source: VoiceSource
    if (s.kind === 'builtin' && typeof s.id === 'string' && s.id in BUILTINS) source = { kind: 'builtin', id: s.id as BuiltinId }
    else if (s.kind === 'file' && typeof s.blobId === 'string' && s.blobId.length < 100) source = { kind: 'file', blobId: s.blobId, name: cleanName(s.name, 'Audio file'), seconds: num(s.seconds, `voices[${i}].source.seconds`, 0, 600) }
    else throw new SchemaError(`voices[${i}].source is not a known kind`)
    return {
      id: typeof v.id === 'string' && v.id.length < 100 ? v.id : newId(),
      name: cleanName(v.name, `Voice ${i + 1}`),
      color: typeof v.color === 'string' && /^#[0-9a-f]{6}$/i.test(v.color) ? v.color : COLORS[i % COLORS.length]!,
      source,
      gainDb: num(v.gainDb, `voices[${i}].gainDb`, GAIN_LIMITS_DB.min, GAIN_LIMITS_DB.max),
      mute: v.mute === true,
      solo: v.solo === true,
      path: readPath(v.path, `voices[${i}].path`, duration),
    }
  })
  return { version: SCHEMA_VERSION, name: cleanName(raw.name, 'Untitled orbit'), duration, loop: raw.loop !== false, voices }
}
