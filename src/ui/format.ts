import { azimuth, distance, type StagePoint } from '../audio/coords'

/** 0:03.2 */
export const fmtTime = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`

/** Signed azimuth as the stage labels it: +90° right, −90° left, 180° behind. */
export function fmtAzimuth(p: StagePoint): string {
  const a = Math.round(azimuth(p))
  if (a === 0 || Math.abs(a) === 180) return `${Math.abs(a)}°`
  return `${a > 0 ? '+' : '−'}${Math.abs(a)}°`
}

/** 2.5 m · +90° */
export const fmtWhere = (p: StagePoint) => `${distance(p).toFixed(1)} m · ${fmtAzimuth(p)}`

export const fmtDb = (db: number) => `${db > 0 ? '+' : db < 0 ? '−' : ''}${Math.abs(db).toFixed(1)} dB`
