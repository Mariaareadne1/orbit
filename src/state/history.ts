/**
 * Undo history with gesture coalescing. A slider drag or graph-handle drag
 * calls `preview` many times and `commit` once, producing one undo step.
 */
export interface History<T> {
  past: T[]
  present: T
  future: T[]
  /** snapshot taken when a gesture began; null when no gesture is open */
  gestureStart: T | null
}

export const HISTORY_LIMIT = 100

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [], gestureStart: null }
}

/** Apply a discrete change as one undo step. */
export function push<T>(h: History<T>, next: T): History<T> {
  if (Object.is(next, h.present)) return h
  return { past: [...h.past, h.present].slice(-HISTORY_LIMIT), present: next, future: [], gestureStart: null }
}

/** Show an in-progress value without creating an undo step yet. */
export function preview<T>(h: History<T>, next: T): History<T> {
  return { ...h, present: next, gestureStart: h.gestureStart ?? h.present }
}

/** Close an open gesture: everything since it began becomes a single step. */
export function commit<T>(h: History<T>, equals: (a: T, b: T) => boolean = Object.is): History<T> {
  if (h.gestureStart === null) return h
  if (equals(h.gestureStart, h.present)) return { ...h, gestureStart: null }
  return {
    past: [...h.past, h.gestureStart].slice(-HISTORY_LIMIT),
    present: h.present,
    future: [],
    gestureStart: null,
  }
}

export function undo<T>(h: History<T>): History<T> {
  const settled = commit(h)
  const prev = settled.past[settled.past.length - 1]
  if (prev === undefined) return settled
  return { past: settled.past.slice(0, -1), present: prev, future: [settled.present, ...settled.future], gestureStart: null }
}

export function redo<T>(h: History<T>): History<T> {
  const settled = commit(h)
  const next = settled.future[0]
  if (next === undefined) return settled
  return { past: [...settled.past, settled.present], present: next, future: settled.future.slice(1), gestureStart: null }
}

/** Replace the present without touching undo (e.g. switching to another project). */
export function reset<T>(present: T): History<T> {
  return createHistory(present)
}
