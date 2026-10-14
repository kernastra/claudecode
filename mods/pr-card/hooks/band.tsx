// The PR bar above the prompt, in the style of effortless's dashboard bar (github.com/HeyCubit/effortless, MIT,
// Copyright (c) 2026 HeyCubit): a rounded #141416 panel, art in an absolute layer at the right edge, and rows made
// "positioned" by an empty absolute child so they paint, and take clicks, over the art. The art itself is ours.

import type { ElementTable, RenderElement, RenderSurface } from 'claude-code'

import type { PrData, PrEntry } from '../types'
import { clock } from './card'
import { mergeIndicator, stateIndicator, summarizeChecks, summarizeReviews, type Indicator, type Tone } from './status'

const BG = '#141416'
const EDGE = '#2a2a2f'
const TEXT = '#d4d4d8'
const DIM = '#8b8b93'
const LINK = '#9a9aa3'
const ORANGE = '#d97757'
const TONE: Record<Tone, string> = { success: '#4eba65', error: '#E5534B', warning: '#E0A23B', merged: '#af87ff', neutral: DIM }

// The art's box in CSS pixels; it is cut to the bar's height and pinned to its right edge.
const ART_W = 520
const ART_H = 64

export type BandMood = 'calm' | 'pending' | 'failing'

export function moodOf(pr: PrData | undefined): BandMood {
  if (!pr || pr.state !== 'OPEN') return 'calm'
  const checks = summarizeChecks(pr)
  if (checks.overall === 'failing' || pr.mergeable === 'CONFLICTING') return 'failing'
  if (checks.overall === 'pending') return 'pending'
  return 'calm'
}

/**
 * The wash behind the bar's right side, always in motion: a colour that breathes, a soft light sweeping across it,
 * embers drifting up through it, and while checks run, amber dots racing along. CSS inside the SVG animates it, so
 * no plugin code runs per frame; a redraw restarts it. Reduced motion holds it still.
 */
export function bandArt(mood: BandMood, elapsedMs = 0): string {
  // The bar redraws often (constantly while Claude works), and each redraw would start the animation over, so it
  // looked frozen. Every animated element starts its timeline `elapsedMs` in, so a redraw carries on where it was.
  const at = (delay: number) => `animation-delay:${(delay - Math.max(0, elapsedMs) / 1000).toFixed(2)}s`
  const hue = mood === 'failing' ? '#E5534B' : ORANGE
  const light = mood === 'failing' ? '#ff8a80' : '#f0a07e'
  const breath = mood === 'failing' ? 2.2 : 4.2
  const embers = [0, 1, 2, 3, 4, 5, 6]
    .map(i => {
      const x = 170 + i * 27
      const y = 22 + ((i * 5) % 7)
      return `<circle class="e" cx="${x}" cy="${y}" r="${(0.6 + (i % 3) * 0.25).toFixed(2)}" style="animation-duration:${(5.5 + (i % 4) * 1.3).toFixed(1)}s;${at(i * 0.9)}"/>`
    })
    .join('')
  const dots =
    mood === 'pending'
      ? [0, 1, 2, 3, 4]
          .map(i => `<circle class="d" cx="150" cy="${8 + ((i * 7) % 16)}" r="1.1" style="animation-duration:${3.2 + i * 0.5}s;${at(i * 0.7)}"/>`)
          .join('')
      : ''
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${ART_W}" height="${ART_H}" viewBox="0 0 360 30" preserveAspectRatio="xMaxYMid slice">` +
    `<style>` +
    `.br{animation:br ${breath}s ease-in-out infinite}@keyframes br{0%,100%{opacity:.55}50%{opacity:1}}` +
    `.sw{animation:sw 6.5s ease-in-out infinite}@keyframes sw{0%{transform:translateX(-90px)}60%,100%{transform:translateX(380px)}}` +
    `.e{fill:${light};opacity:0;animation-name:up;animation-timing-function:ease-out;animation-iteration-count:infinite}` +
    `@keyframes up{0%{opacity:0;transform:translate(0,0)}20%{opacity:.75}100%{opacity:0;transform:translate(-14px,-22px)}}` +
    `.d{fill:#E0A23B;opacity:0;animation-name:go;animation-timing-function:ease-in-out;animation-iteration-count:infinite}` +
    `@keyframes go{0%{opacity:0;transform:translate(0,0)}15%{opacity:.9}85%{opacity:.6}100%{opacity:0;transform:translate(200px,0)}}` +
    `@media (prefers-reduced-motion:reduce){.br,.sw,.e,.d{animation:none}.sw,.e,.d{opacity:0}}</style>` +
    `<defs><linearGradient id="w" x1="0" x2="1"><stop offset=".3" stop-color="${hue}" stop-opacity="0"/>` +
    `<stop offset=".68" stop-color="${hue}" stop-opacity=".24"/><stop offset="1" stop-color="${light}" stop-opacity=".52"/></linearGradient>` +
    `<linearGradient id="f" x1="0" x2="1"><stop offset=".3" stop-color="#fff" stop-opacity="0"/><stop offset=".72" stop-color="#fff" stop-opacity="1"/></linearGradient>` +
    `<linearGradient id="s" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".16"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>` +
    `<mask id="m"><rect width="360" height="30" fill="url(#f)"/></mask>` +
    `<pattern id="g" width="2" height="2" patternUnits="userSpaceOnUse"><rect width=".6" height=".6" fill="#fff" fill-opacity=".07"/></pattern></defs>` +
    `<g mask="url(#m)"><rect class="br" style="${at(0)}" width="360" height="30" fill="url(#w)"/>` +
    `<rect class="sw" style="${at(0)}" x="0" y="-10" width="70" height="50" fill="url(#s)" transform="skewX(-20)"/>` +
    `<rect width="360" height="30" fill="url(#g)"/>${embers}</g>${dots}</svg>`
  )
}

const PR_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="14" height="14"><path fill="${ORANGE}" d="M1.5 3.25a2.25 2.25 0 1 1 3 2.122v5.256a2.251 2.251 0 1 1-1.5 0V5.372A2.25 2.25 0 0 1 1.5 3.25Zm5.677-.177L9.573.677A.25.25 0 0 1 10 .854V2.5h1A2.5 2.5 0 0 1 13.5 5v5.628a2.251 2.251 0 1 1-1.5 0V5a1 1 0 0 0-1-1h-1v1.646a.25.25 0 0 1-.427.177L7.177 3.427a.25.25 0 0 1 0-.354ZM3.75 2.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm0 9.5a.75.75 0 1 0 0 1.5.75.75 0 0 0 0-1.5Zm8.25.75a.75.75 0 1 0 1.5 0 .75.75 0 0 0-1.5 0Z"/></svg>`

export type BandActions = {
  details: () => void
  refresh: () => void
  hide: () => void
}

export type BandProps = {
  /** How long the art has been running, so a redraw continues its animation instead of restarting it. */
  artElapsedMs?: number
  els: ElementTable
  surface: RenderSurface
  columns: number
  prKey: string
  entry: PrEntry | undefined
  actions: BandActions
}

/** The status bits that fit: checks always, then reviews, unresolved threads and merge state as width allows. */
function chips(pr: PrData, columns: number): Indicator[] {
  const checks = summarizeChecks(pr)
  const reviews = summarizeReviews(pr)
  const merge = mergeIndicator(pr)
  const list: Indicator[] = [checks.indicator]
  if (columns >= 90 && reviews.indicator) list.push(reviews.indicator)
  if (columns >= 105 && reviews.unresolved > 0)
    list.push({ glyph: '◦', label: `${reviews.unresolved}${reviews.unresolvedIsFloor ? '+' : ''} open`, tone: 'warning' })
  if (columns >= 120 && merge) list.push(merge)
  return list
}

export function renderBand(props: BandProps): RenderElement {
  const { els, surface, columns, prKey, entry, actions } = props
  const { Box, Text, Button, Link } = els
  const pr = entry?.data
  const title = pr ? `#${pr.number} ${pr.title}` : prKey
  const state = pr ? stateIndicator(pr) : null
  const items = pr ? chips(pr, columns) : []
  const note = entry?.isLoading ? 'Refreshing…' : entry?.error && !pr ? entry.error.message : entry?.error ? `Couldn't refresh · ${entry.fetchedAt ? clock(entry.fetchedAt) : ''}` : ''

  if (surface === 'terminal' || !('Svg' in els)) {
    return (
      <Box key="prband" flexDirection="row" alignItems="center" gap={2} paddingX={1} borderStyle="round" borderColor="subtle" overflow="hidden">
        <Text color="claude">⎇</Text>
        <Box flexShrink={1}>
          <Text bold wrap="truncate-end">{title}</Text>
        </Box>
        {items.map(item => (
          <Text color={item.tone === 'neutral' ? 'inactive' : item.tone}>{`${item.glyph} ${item.label}`}</Text>
        ))}
        {note ? <Text dimColor wrap="truncate-end">{note}</Text> : null}
        <Box flexGrow={1} />
        <Button key="prband-details" label="Details" onPress={actions.details} />
        <Button key="prband-hide" label="Hide" dimColor onPress={actions.hide} />
      </Box>
    )
  }

  const { Svg } = els
  return (
    <Box key="prband" position="relative" flexDirection="row" alignItems="center" paddingX={1} overflow="hidden" backgroundColor={BG} borderStyle="round" borderColor={EDGE}>
      <Box key="prband-art" position="absolute" top={-1} right={0} bottom={-1}>
        <Svg source={bandArt(moodOf(pr), props.artElapsedMs ?? 0)} alt="PR status glow" width={ART_W} height={ART_H} />
      </Box>
      <Box key="prband-main" flexDirection="row" alignItems="center" gap={2} flexShrink={1} overflow="hidden">
        <Box position="absolute" top={0} left={0} />
        <Box flexDirection="row" alignItems="center" gap={1} flexShrink={1}>
          <Svg source={PR_ICON} alt="Pull request" width={14} height={14} />
          <Text color={TEXT} bold wrap="truncate-end">
            {title}
          </Text>
          {state ? <Text color={DIM}>{state.label}</Text> : null}
        </Box>
        {items.map(item => (
          <Box flexDirection="row" gap={1} flexShrink={0}>
            <Text color={TONE[item.tone]}>{item.glyph}</Text>
            <Text color={TEXT}>{item.label}</Text>
          </Box>
        ))}
        {note ? (
          <Text color={DIM} wrap="truncate-end">
            {note}
          </Text>
        ) : null}
      </Box>
      <Box minWidth={1} flexGrow={1} />
      <Box key="prband-actions" flexShrink={0} flexDirection="row" gap={1} alignItems="center" marginLeft={1}>
        <Box position="absolute" top={0} left={0} />
        {pr ? (
          <Text color={LINK}>
            <Link href={pr.url} label="GitHub ↗" />
          </Text>
        ) : null}
        <Button key="prband-refresh" plain dimColor label="Refresh" onPress={actions.refresh} />
        <Button key="prband-details" variant="primary" label="Details" onPress={actions.details} />
        <Button key="prband-hide" plain label="✕" onPress={actions.hide} />
      </Box>
    </Box>
  )
}
