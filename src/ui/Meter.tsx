import { useEffect, useRef } from 'react'
import type { OrbitEngine } from '../audio/engine'

const FLOOR_DB = -48

/**
 * Output level measured from the live master (AnalyserNode per channel). Shows
 * nothing when nothing is playing: no animation that isn't the signal.
 */
export function Meter({ engine, playing }: { engine: OrbitEngine; playing: boolean }) {
  const left = useRef<HTMLSpanElement>(null)
  const right = useRef<HTMLSpanElement>(null)
  const text = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    let raf = 0
    let held = 0
    const draw = () => {
      const lv = engine.level()
      const toFrac = (x: number) => (x <= 0 ? 0 : Math.max(0, Math.min(1, (20 * Math.log10(x) - FLOOR_DB) / -FLOOR_DB)))
      if (left.current) left.current.style.transform = `scaleX(${lv ? toFrac(lv.left) : 0})`
      if (right.current) right.current.style.transform = `scaleX(${lv ? toFrac(lv.right) : 0})`
      const pk = lv ? Math.max(lv.left, lv.right) : 0
      held = Math.max(pk, held * 0.95)
      if (text.current) text.current.textContent = lv && held > 1e-5 ? `${(20 * Math.log10(held)).toFixed(1)} dBFS` : '— dBFS'
      if (playing) raf = requestAnimationFrame(draw)
    }
    draw()
    return () => cancelAnimationFrame(raf)
  }, [engine, playing])
  return (
    <div className="meter" role="img" aria-label="Output level, measured from the live audio (left and right)">
      <span className="meter__row"><span className="meter__ch">L</span><span className="meter__track"><span ref={left} className="meter__bar" /></span></span>
      <span className="meter__row"><span className="meter__ch">R</span><span className="meter__track"><span ref={right} className="meter__bar" /></span></span>
      <span ref={text} className="meter__value mono">— dBFS</span>
    </div>
  )
}
