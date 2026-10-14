// The usage band's background: one animated theme per month, after that month's major (US) holiday.
// Each theme is a soft colour wash plus particles with their own motion, drawn as one SVG with CSS animation
// inside it (Desktop plays it as an image; no plugin code runs per frame). Particles stay faint so the
// band's text reads over them. Every animated element starts `elapsedMs` into its timeline, so a redraw
// continues the animation instead of restarting it.

export type Motion = 'fall' | 'rise' | 'drift' | 'twinkle' | 'burst' | 'bob'

export type Season = {
  id: string
  /** What the theme celebrates, for the preview command and the art's alt text. */
  name: string
  /** The wash: left colour (faint) to right colour (strongest). */
  wash: [string, string]
  /** Particle shapes as SVG markup drawn around 0,0, about 6 units across. */
  shapes: string[]
  colors: string[]
  motion: Motion
  count: number
  /** Seconds per cycle, before each particle's own variation. */
  speed: number
}

const P = {
  dot: '<circle r="1"/>',
  snow: '<circle r="1.1"/>',
  star: '<path d="M0-2.4L.55-.55 2.4 0 .55.55 0 2.4-.55.55-2.4 0-.55-.55Z"/>',
  heart: '<path d="M0 1.9C-2.8 0-1.4-2.3 0-.9C1.4-2.3 2.8 0 0 1.9Z"/>',
  leaf: '<path d="M0-2.6C1.9-1.2 1.9 1.2 0 2.6C-1.9 1.2-1.9-1.2 0-2.6Z"/>',
  clover: '<g><circle cx="0" cy="-1.1" r="1.1"/><circle cx="-1" cy=".5" r="1.1"/><circle cx="1" cy=".5" r="1.1"/></g>',
  egg: '<ellipse rx="1.5" ry="2"/>',
  petal: '<path d="M0-2.2C1.6-1.6 1.8.8 0 2.2C-1.8.8-1.6-1.6 0-2.2Z"/>',
  bat: '<path d="M-3.6 0Q-2.6-1.8-1.2-.6Q-.5-1.6 0-.7Q.5-1.6 1.2-.6Q2.6-1.8 3.6 0Q1.8-.4 0 1Q-1.8-.4-3.6 0Z"/>',
  ring: '<circle r="2.2" fill="none" stroke-width=".7"/>',
}

/** Index 0 is January. */
export const SEASONS: Season[] = [
  { id: 'new-year', name: "New Year's", wash: ['#2a2410', '#b8913a'], shapes: [P.star, P.ring], colors: ['#f3d27a', '#fff1c4', '#e8b84a'], motion: 'burst', count: 9, speed: 3.6 },
  { id: 'valentines', name: "Valentine's Day", wash: ['#2a1018', '#c2456b'], shapes: [P.heart], colors: ['#ff8fae', '#ff5c86', '#ffc2d2'], motion: 'rise', count: 9, speed: 7 },
  { id: 'st-patricks', name: "St. Patrick's Day", wash: ['#0f2416', '#3f9b5a'], shapes: [P.clover, P.clover, P.star], colors: ['#6fd38c', '#3fb86a', '#f3d27a'], motion: 'drift', count: 9, speed: 9 },
  { id: 'easter', name: 'Easter', wash: ['#1c1a26', '#8f86c9'], shapes: [P.egg], colors: ['#c9b8ff', '#a8e6cf', '#ffd3b6', '#ffaaa5'], motion: 'bob', count: 8, speed: 3.4 },
  { id: 'mothers-day', name: "Mother's Day", wash: ['#26161c', '#d0849b'], shapes: [P.petal], colors: ['#ffc4d6', '#ffb3c7', '#ffe0ea'], motion: 'fall', count: 10, speed: 8 },
  { id: 'fathers-day', name: "Father's Day", wash: ['#101a2a', '#4f74b3'], shapes: [P.star, P.dot], colors: ['#c9dcff', '#9ec1ff', '#ffffff'], motion: 'twinkle', count: 12, speed: 3.2 },
  { id: 'independence', name: 'Independence Day', wash: ['#141a2e', '#b23a48'], shapes: [P.ring, P.star], colors: ['#ff5c6c', '#ffffff', '#6ea8ff'], motion: 'burst', count: 9, speed: 3 },
  { id: 'summer', name: 'Late summer', wash: ['#1f1a0e', '#c98a2b'], shapes: [P.dot], colors: ['#ffe48a', '#fff3b8', '#f7c948'], motion: 'twinkle', count: 14, speed: 2.6 },
  { id: 'labor-day', name: 'Labor Day', wash: ['#1d1a10', '#a8862e'], shapes: [P.leaf], colors: ['#d9b44a', '#a8c256', '#e08a3c'], motion: 'fall', count: 8, speed: 9 },
  { id: 'halloween', name: 'Halloween', wash: ['#1b1226', '#d9692b'], shapes: [P.bat, P.bat, P.dot], colors: ['#8a63c4', '#a77ee0', '#ff9a3c'], motion: 'drift', count: 10, speed: 11 },
  { id: 'thanksgiving', name: 'Thanksgiving', wash: ['#22160c', '#b8652a'], shapes: [P.leaf], colors: ['#e08a3c', '#c2552b', '#e8b04a', '#8f4a24'], motion: 'fall', count: 11, speed: 8.5 },
  { id: 'christmas', name: 'Christmas', wash: ['#0f1c16', '#a8323e'], shapes: [P.snow, P.snow, P.star], colors: ['#ffffff', '#e8f1ff', '#ff6b6b', '#6fd38c'], motion: 'fall', count: 16, speed: 7 },
]

export function seasonFor(date: Date): Season {
  return SEASONS[date.getMonth()]!
}

/** A month from "10", "oct", "october", "halloween" or "christmas"; undefined when it names none. */
export function seasonByName(text: string): Season | undefined {
  const t = text.trim().toLowerCase()
  if (!t) return undefined
  const n = Number(t)
  if (Number.isInteger(n) && n >= 1 && n <= 12) return SEASONS[n - 1]
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
  const byMonth = months.findIndex(m => t.startsWith(m))
  if (byMonth >= 0) return SEASONS[byMonth]
  return SEASONS.find(s => s.id.startsWith(t.replace(/\s+/g, '-')) || s.name.toLowerCase().startsWith(t))
}

// The art is drawn at 2 px per unit, 64 px tall (32 units), and pinned to the band's right edge. It is wider
// than any band, so the band trims its left end; nothing depends on knowing the band's width in pixels.
const VH = 32
const VW = 1200
export const ART_W = VW * 2
export const ART_H = 64
/** The stretch at the right where the colour builds and the particles live, in units (about 1100 px). */
const STAGE = 550

const KEYFRAMES: Record<Motion, string> = {
  fall: '@keyframes mv{0%{opacity:0;transform:translate(0,-8px) rotate(0deg)}15%{opacity:.8}85%{opacity:.6}100%{opacity:0;transform:translate(-18px,42px) rotate(220deg)}}',
  rise: '@keyframes mv{0%{opacity:0;transform:translate(0,10px) scale(.7)}20%{opacity:.8}100%{opacity:0;transform:translate(8px,-34px) scale(1.05)}}',
  drift: '@keyframes mv{0%{opacity:0;transform:translate(-60px,0)}15%{opacity:.85}50%{transform:translate(120px,-6px)}85%{opacity:.7}100%{opacity:0;transform:translate(300px,3px)}}',
  twinkle: '@keyframes mv{0%,100%{opacity:0;transform:scale(.6)}50%{opacity:.9;transform:scale(1.15)}}',
  burst: '@keyframes mv{0%{opacity:0;transform:scale(.2)}20%{opacity:.85}100%{opacity:0;transform:scale(2.6)}}',
  bob: '@keyframes mv{0%,100%{opacity:.6;transform:translate(0,0) rotate(-8deg)}50%{opacity:.9;transform:translate(0,-4px) rotate(8deg)}}',
}

/** A small, repeatable spread: the same particles on every draw, so a redraw does not reshuffle them. */
function spread(i: number, salt: number): number {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453
  return x - Math.floor(x)
}

export function seasonArt(season: Season, elapsedMs = 0): string {
  const at = (delay: number) => `animation-delay:${(delay - Math.max(0, elapsedMs) / 1000).toFixed(2)}s`
  const particles: string[] = []
  for (let i = 0; i < season.count; i++) {
    const x = VW - 12 - spread(i, 1) * (STAGE - 24)
    const y = season.motion === 'fall' ? 2 + spread(i, 2) * 8 : season.motion === 'rise' ? 22 + spread(i, 2) * 8 : 6 + spread(i, 2) * (VH - 12)
    const scale = 1.1 + spread(i, 3) * 0.8
    const duration = season.speed * (0.75 + spread(i, 4) * 0.6)
    const shape = season.shapes[i % season.shapes.length]!
    const color = season.colors[i % season.colors.length]!
    const stroke = shape.includes('fill="none"') ? ` stroke="${color}"` : ''
    particles.push(
      `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) scale(${scale.toFixed(2)})">` +
        `<g class="p" fill="${color}"${stroke} style="animation-duration:${duration.toFixed(1)}s;${at(spread(i, 5) * duration)}">${shape}</g></g>`,
    )
  }
  const [from, to] = season.wash
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${ART_W}" height="${ART_H}" viewBox="0 0 ${VW} ${VH}" preserveAspectRatio="xMaxYMid slice">` +
    `<style>.p{opacity:0;transform-box:fill-box;transform-origin:center;animation-name:mv;animation-timing-function:ease-in-out;animation-iteration-count:infinite}` +
    `${KEYFRAMES[season.motion]}.br{animation:br 5s ease-in-out infinite}@keyframes br{0%,100%{opacity:.7}50%{opacity:1}}` +
    `@media (prefers-reduced-motion:reduce){.p,.br{animation:none}.p{opacity:.35}}</style>` +
    `<defs><linearGradient id="w" gradientUnits="userSpaceOnUse" x1="${VW - STAGE}" x2="${VW}" y1="0" y2="0"><stop offset="0" stop-color="${from}" stop-opacity=".55"/>` +
    `<stop offset=".5" stop-color="${from}" stop-opacity=".9"/><stop offset="1" stop-color="${to}" stop-opacity=".62"/></linearGradient>` +
    `<pattern id="g" width="2" height="2" patternUnits="userSpaceOnUse"><rect width=".5" height=".5" fill="#fff" fill-opacity=".05"/></pattern></defs>` +
    `<rect class="br" style="${at(0)}" width="${VW}" height="${VH}" fill="url(#w)"/><rect width="${VW}" height="${VH}" fill="url(#g)"/>` +
    `${particles.join('')}</svg>`
  )
}
