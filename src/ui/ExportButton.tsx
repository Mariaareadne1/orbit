import { useState } from 'react'
import { renderArrangement, type OrbitEngine } from '../audio/engine'
import { countClipped, peak } from '../audio/analysis'
import { encodeWav } from '../audio/wav'
import { audible, type OrbitDoc } from '../state/document'

function download(name: string, bytes: Uint8Array) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'audio/wav' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export function ExportButton({ doc, engine }: { doc: OrbitDoc; engine: OrbitEngine }) {
  const [status, setStatus] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  return (
    <div className="export">
      <button type="button" className="button button--primary" disabled={busy} aria-busy={busy} onClick={async () => {
        setBusy(true)
        setStatus('Rendering…')
        try {
          const t0 = performance.now()
          const skipped = audible(doc.voices).filter((v) => !engine.bank.samples(v, doc.duration)).map((v) => v.name)
          const r = await renderArrangement(doc, engine.bank)
          const { bytes, clipped } = encodeWav([r.left, r.right], r.sampleRate)
          const pk = Math.max(peak(r.left), peak(r.right))
          download(`${doc.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'orbit'}.wav`, bytes)
          const over = countClipped(r.left) + countClipped(r.right)
          setStatus(`WAV · ${doc.duration} s · 48 kHz stereo 16-bit · peak ${(20 * Math.log10(Math.max(pk, 1e-9))).toFixed(1)} dBFS · ${clipped} clipped${over || clipped ? ' — lower some levels' : ''}${skipped.length ? ` · skipped ${skipped.join(', ')} (audio missing)` : ''} · ${Math.round(performance.now() - t0)} ms`)
        } catch (err) {
          setStatus(`Export failed: ${err instanceof Error ? err.message : 'unknown error'}`)
        } finally {
          setBusy(false)
        }
      }}>{busy ? 'Rendering…' : 'Export WAV'}</button>
      {status && <span className="export__status mono" role="status" data-testid="export-status">{status}</span>}
    </div>
  )
}
