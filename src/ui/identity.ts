import { COLORS, type VoiceDoc } from '../state/document'

/** A shape per palette slot: identity that survives colour blindness and greyscale. */
export type Shape = 'circle' | 'square' | 'triangle' | 'diamond' | 'hexagon' | 'cross'
const SHAPES: Shape[] = ['circle', 'square', 'triangle', 'diamond', 'hexagon', 'cross']

export function shapeOf(voice: VoiceDoc, index: number): Shape {
  const slot = COLORS.indexOf(voice.color)
  return SHAPES[(slot >= 0 ? slot : index) % SHAPES.length]!
}

/** SVG path for a shape of radius `r`, centred on the origin. */
export function shapePath(shape: Shape, r: number): string {
  const poly = (n: number, rot: number) =>
    Array.from({ length: n }, (_, i) => {
      const a = rot + (i * 2 * Math.PI) / n
      return `${(r * Math.sin(a)).toFixed(2)} ${(-r * Math.cos(a)).toFixed(2)}`
    }).join(' L') + ' Z'
  switch (shape) {
    case 'circle':
      return `M${-r} 0 A${r} ${r} 0 1 0 ${r} 0 A${r} ${r} 0 1 0 ${-r} 0 Z`
    case 'square': {
      const s = r * 0.86
      return `M${-s} ${-s} H${s} V${s} H${-s} Z`
    }
    case 'triangle':
      return `M${poly(3, 0)}`
    case 'diamond':
      return `M${poly(4, 0)}`
    case 'hexagon':
      return `M${poly(6, Math.PI / 6)}`
    case 'cross': {
      const a = r * 0.36
      return `M${-a} ${-r} H${a} V${-a} H${r} V${a} H${a} V${r} H${-a} V${a} H${-r} V${-a} H${-a} Z`
    }
  }
}
