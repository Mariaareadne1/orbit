/**
 * Read-only hooks for the browser test suite (and curious developers): the
 * live engine and the current document. Nothing in the app reads these.
 */
import type { OrbitEngine } from './audio/engine'
import type { OrbitDoc } from './state/document'

export interface DebugHandle {
  engine: OrbitEngine
  doc: () => OrbitDoc
}

export function registerDebug(handle: DebugHandle) {
  const w = window as unknown as { orbit?: Record<string, unknown> }
  w.orbit = { ...(w.orbit ?? {}), ...handle }
}
