/** The document in localStorage; imported audio bytes in IndexedDB. Local only. */
import { parseDoc, SchemaError, type OrbitDoc } from './document'

export const DOC_KEY = 'orbit.document.v1'

export type LoadedDoc = { status: 'ok'; doc: OrbitDoc } | { status: 'empty' } | { status: 'unreadable'; reason: string }

export function loadDoc(): LoadedDoc {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(DOC_KEY)
  } catch {
    return { status: 'empty' }
  }
  if (raw === null) return { status: 'empty' }
  try {
    return { status: 'ok', doc: parseDoc(JSON.parse(raw)) }
  } catch (err) {
    // Keep the unreadable copy aside before anything overwrites it.
    try {
      localStorage.setItem(`${DOC_KEY}.unreadable.${Date.now()}`, raw)
    } catch {
      // storage full: nothing more we can do safely
    }
    return { status: 'unreadable', reason: err instanceof SchemaError ? err.message : 'not valid JSON' }
  }
}

export function saveDoc(doc: OrbitDoc): boolean {
  try {
    localStorage.setItem(DOC_KEY, JSON.stringify(doc))
    return true
  } catch {
    return false
  }
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('orbit', 1)
    req.onupgradeneeded = () => req.result.createObjectStore('files')
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open()
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction('files', mode)
    const r = fn(t.objectStore('files'))
    t.oncomplete = () => {
      db.close()
      resolve(r.result)
    }
    t.onerror = () => reject(t.error)
    // Quota failures surface as an abort at commit, not a request error.
    t.onabort = () => reject(t.error ?? new Error('Storage transaction aborted'))
  })
}

export const files = {
  put: (id: string, bytes: ArrayBuffer) => tx('readwrite', (s) => s.put(bytes, id)),
  get: (id: string) => tx<ArrayBuffer | undefined>('readonly', (s) => s.get(id)),
  remove: (id: string) => tx('readwrite', (s) => s.delete(id)),
  keys: () => tx<IDBValidKey[]>('readonly', (s) => s.getAllKeys()),
}
