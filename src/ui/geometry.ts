import { stageToScreen, type StagePoint } from '../audio/coords'
import { STAGE_RADIUS } from '../state/document'

/**
 * The soundstage's drawing space (SVG viewBox units). One metre is the same
 * number of units in x and y, so rings are true circles and distances on screen
 * are proportional to distances the panner hears.
 */
export const VIEW = 720
export const CENTER = VIEW / 2
/** room around the 5 m ring for the azimuth scale */
const MARGIN = 64
export const SCALE = (CENTER - MARGIN) / STAGE_RADIUS

export const toScreen = (p: StagePoint) => stageToScreen(p, CENTER, CENTER, SCALE)
