/**
 * WAV encoder: 16-bit PCM, interleaved. Samples beyond ±1 are clamped and
 * counted (the renderer reports clipping rather than hiding it).
 */
export interface EncodedWav {
  bytes: Uint8Array
  clipped: number
}

export function encodeWav(channels: Float32Array[], sampleRate: number): EncodedWav {
  const numChannels = channels.length
  const frames = channels[0]?.length ?? 0
  const dataBytes = frames * numChannels * 2
  const buf = new ArrayBuffer(44 + dataBytes)
  const v = new DataView(buf)
  const ascii = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
  ascii(0, 'RIFF')
  v.setUint32(4, 36 + dataBytes, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  v.setUint32(16, 16, true)
  v.setUint16(20, 1, true) // PCM
  v.setUint16(22, numChannels, true)
  v.setUint32(24, sampleRate, true)
  v.setUint32(28, sampleRate * numChannels * 2, true)
  v.setUint16(32, numChannels * 2, true)
  v.setUint16(34, 16, true)
  ascii(36, 'data')
  v.setUint32(40, dataBytes, true)
  let o = 44
  let clipped = 0
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < numChannels; c++) {
      let s = channels[c]![i]!
      if (s >= 1 || s <= -1) clipped++
      s = Math.max(-1, Math.min(1, s))
      v.setInt16(o, Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), true)
      o += 2
    }
  }
  return { bytes: new Uint8Array(buf), clipped }
}

/** Minimal reader for tests: 16-bit PCM only. */
export function decodeWav(bytes: Uint8Array): { sampleRate: number; channels: Float32Array[] } {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const numChannels = v.getUint16(22, true)
  const sampleRate = v.getUint32(24, true)
  const dataBytes = v.getUint32(40, true)
  const frames = dataBytes / (2 * numChannels)
  const channels = Array.from({ length: numChannels }, () => new Float32Array(frames))
  let o = 44
  for (let i = 0; i < frames; i++)
    for (let c = 0; c < numChannels; c++) {
      const s = v.getInt16(o, true)
      channels[c]![i] = s < 0 ? s / 0x8000 : s / 0x7fff
      o += 2
    }
  return { sampleRate, channels }
}
