import { useState } from 'react'
import { renderArrangement, type OrbitEngine } from '../audio/engine'
import { countClipped, peak } from '../audio/analysis'
import { encodeWav } from '../audio/wav'
import type { OrbitDoc } from '../state/document'

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
      <button type="button" className="primary" disabled={busy} onClick={async () => {
        setBusy(true)
        setStatus('Rendering…')
        try {
          const t0 = performance.now()
          const r = await renderArrangement(doc, engine.bank)
          const { bytes, clipped } = encodeWav([r.left, r.right], r.sampleRate)
          const pk = Math.max(peak(r.left), peak(r.right))
          download(`${doc.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'orbit'}.wav`, bytes)
          const over = countClipped(r.left) + countClipped(r.right)
          setStatus(`${doc.duration}s · 48 kHz stereo · peak ${(20 * Math.log10(Math.max(pk, 1e-9))).toFixed(1)} dBFS${over || clipped ? ` · ${clipped} clipped samples — lower some levels` : ''} · ${Math.round(performance.now() - t0)} ms`)
        } catch (err) {
          setStatus(`Export failed: ${err instanceof Error ? err.message : 'unknown error'}`)
        } finally {
          setBusy(false)
        }
      }}>Export WAV</button>
      {status && <span className="export__status mono" role="status" data-testid="export-status">{status}</span>}
    </div>
  )
}
