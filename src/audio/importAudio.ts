/**
 * Local audio import. Files never leave the browser: checked by size and
 * magic bytes, decoded by the browser at 48 kHz, mixed to mono (a point
 * source is mono; stereo would be panned as a pair).
 */
import { ENGINE_RATE } from './engine'

export const MAX_AUDIO_BYTES = 40 * 1024 * 1024
export const MAX_AUDIO_SECONDS = 300

export class AudioImportError extends Error {}

export function sniffAudio(h: Uint8Array): string | null {
  const ascii = (a: number, b: number) => String.fromCharCode(...h.slice(a, b))
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return 'wav'
  if (ascii(0, 4) === 'OggS') return 'ogg'
  if (ascii(0, 4) === 'fLaC') return 'flac'
  if (ascii(4, 8) === 'ftyp') return 'm4a'
  if (ascii(0, 3) === 'ID3' || (h[0] === 0xff && (h[1]! & 0xe0) === 0xe0)) return 'mp3'
  return null
}

export async function decodeAudioFile(bytes: ArrayBuffer): Promise<Float32Array> {
  if (bytes.byteLength === 0) throw new AudioImportError('The file is empty.')
  if (bytes.byteLength > MAX_AUDIO_BYTES) throw new AudioImportError(`The file is ${(bytes.byteLength / 1e6).toFixed(0)} MB; the limit is ${MAX_AUDIO_BYTES / 1024 / 1024} MB.`)
  if (!sniffAudio(new Uint8Array(bytes.slice(0, 16)))) throw new AudioImportError('Only WAV, MP3, M4A/AAC, OGG and FLAC audio is supported.')
  let decoded: AudioBuffer
  try {
    // An OfflineAudioContext decodes and resamples to its own rate.
    decoded = await new OfflineAudioContext(1, 1, ENGINE_RATE).decodeAudioData(bytes.slice(0))
  } catch {
    throw new AudioImportError('The browser could not decode this audio file.')
  }
  if (decoded.duration > MAX_AUDIO_SECONDS) throw new AudioImportError(`The audio is ${Math.round(decoded.duration)} s long; the limit is ${MAX_AUDIO_SECONDS} s.`)
  const mono = new Float32Array(decoded.length)
  for (let c = 0; c < decoded.numberOfChannels; c++) {
    const d = decoded.getChannelData(c)
    for (let i = 0; i < mono.length; i++) mono[i]! += d[i]! / decoded.numberOfChannels
  }
  return mono
}
