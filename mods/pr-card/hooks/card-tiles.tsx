// The second design, "tiles", after the settings panel of effortless (github.com/HeyCubit/effortless, MIT,
// Copyright (c) 2026 HeyCubit): an inner card inside the #212121 frame, a header strip, and a row of bordered
// tiles that each open a section. Layout and palette only; none of effortless's brand marks or art.
// The terminal draws the first design (card.tsx); this one is for Desktop.

import type { RenderElement } from 'claude-code'

import type { CardSection, PrData } from '../types'
import {
  checksSection,
  clock,
  commitsSection,
  day,
  filesSection,
  icon,
  renderCard,
  reviewsSection,
  type CardProps,
} from './card'
import { mergeIndicator, shortSha, stateIndicator, summarizeChecks, summarizeReviews, type Indicator, type Tone } from './status'

const FRAME = '#212121'
const CARD_BG = '#141416'
const CARD_EDGE = '#2a2a2f'
const HEAD_BG = '#1b1b1f'
const TILE_HOVER = '#1c1c20'
const TILE_HOVER_EDGE = '#3b3b42'
const TEXT = '#d4d4d8'
const DIM = '#8b8b93'
const TONE: Record<Tone, string> = { success: '#4eba65', error: '#E5534B', warning: '#E0A23B', merged: '#af87ff', neutral: DIM }

type Tile = { id: CardSection; title: string; glyph: string; summary: RenderElement }

export function renderTilesCard(props: CardProps): RenderElement {
  const { els, surface, entry } = props
  const pr = entry?.data
  if (surface === 'terminal' || !pr) return renderCard(props)
  const { Box } = els

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={FRAME} backgroundColor={FRAME} padding={1}>
      <Box flexDirection="column" borderStyle="round" borderColor={CARD_EDGE} backgroundColor={CARD_BG} overflow="hidden">
        {header(props, pr)}
        <Box flexDirection="column" paddingX={2} paddingY={1}>
          {tiles(props, pr)}
          {props.ui.section === 'checks' && checksSection(props, pr)}
          {props.ui.section === 'reviews' && reviewsSection(props, pr)}
          {props.ui.section === 'files' && filesSection(props, pr)}
          {props.ui.section === 'commits' && commitsSection(props, pr)}
        </Box>
      </Box>
    </Box>
  )
}

function chip({ els }: CardProps, item: Indicator): RenderElement {
  const { Box, Text } = els
  return (
    <Box flexDirection="row" gap={1}>
      <Text color={TONE[item.tone]}>{item.glyph}</Text>
      <Text color={TEXT}>{item.label}</Text>
    </Box>
  )
}

function header(props: CardProps, pr: PrData): RenderElement {
  const { Box, Text, Button, Link } = props.els
  const { entry } = props
  const merge = mergeIndicator(pr)
  let note: RenderElement
  if (entry?.isLoading) note = <Text color={DIM}>Refreshing…</Text>
  else if (entry?.error && entry.fetchedAt) note = <Text color={TONE.warning}>{`Couldn't refresh · ${clock(entry.fetchedAt)}`}</Text>
  else note = <Text color={DIM}>{entry?.fetchedAt ? clock(entry.fetchedAt) : ''}</Text>

  return (
    <Box flexDirection="column" backgroundColor={HEAD_BG} paddingX={2} paddingY={1}>
      <Box flexDirection="row" justifyContent="space-between" alignItems="center" columnGap={2}>
        <Box flexDirection="row" gap={1} alignItems="center" flexShrink={1}>
          {icon(props)}
          <Text color={TEXT} bold wrap="truncate-end">
            {pr.title}
          </Text>
        </Box>
        <Box flexDirection="row" gap={2} alignItems="center" flexShrink={0}>
          {note}
          <Text color="#9a9aa3">
            <Link href={pr.url} label="GitHub ↗" />
          </Text>
          <Button key="refresh" variant="secondary" label="Refresh" onPress={() => props.actions.refresh()} />
        </Box>
      </Box>
      <Box flexDirection="row" columnGap={2} flexWrap="wrap">
        <Text color={DIM} wrap="truncate-end">{`${pr.owner}/${pr.repo} #${pr.number}${pr.author ? ` · ${pr.author}` : ''}`}</Text>
        {chip(props, stateIndicator(pr))}
        {merge && chip(props, merge)}
        <Text color={DIM} wrap="truncate-middle">{`${pr.headRef} → ${pr.baseRef}`}</Text>
      </Box>
    </Box>
  )
}

function tiles(props: CardProps, pr: PrData): RenderElement {
  const { Box, Text } = props.els
  const checks = summarizeChecks(pr)
  const reviews = summarizeReviews(pr)
  const latest = pr.commits[0]
  const line = (parts: RenderElement[]) => (
    <Box flexDirection="row" gap={1} overflow="hidden">
      {parts}
    </Box>
  )
  const list: Tile[] = [
    {
      id: 'checks',
      title: 'Checks',
      glyph: '✓',
      summary: line([
        <Text color={TONE[checks.indicator.tone]}>{checks.indicator.glyph}</Text>,
        <Text color={DIM} wrap="truncate-end">
          {checks.indicator.label + (checks.failingRequired ? ` · ${checks.failingRequired} required` : '')}
        </Text>,
      ]),
    },
    {
      id: 'reviews',
      title: 'Reviews',
      glyph: '◇',
      summary: line([
        ...(reviews.indicator ? [<Text color={TONE[reviews.indicator.tone]}>{reviews.indicator.glyph}</Text>] : []),
        <Text color={DIM} wrap="truncate-end">
          {[reviews.indicator?.label ?? 'No reviews', reviews.unresolved ? `${reviews.unresolved}${reviews.unresolvedIsFloor ? '+' : ''} open` : '']
            .filter(Boolean)
            .join(' · ')}
        </Text>,
      ]),
    },
    {
      id: 'files',
      title: 'Files',
      glyph: '±',
      summary: line([
        <Text color={DIM}>{`${pr.changedFiles} ·`}</Text>,
        <Text color="diffAdded">{`+${pr.additions}`}</Text>,
        <Text color="diffRemoved">{`−${pr.deletions}`}</Text>,
      ]),
    },
    {
      id: 'commits',
      title: 'Commits',
      glyph: '⋯',
      summary: line([
        <Text color={DIM} wrap="truncate-end">
          {latest ? `${shortSha(latest.sha)}${latest.date ? ` · ${day(latest.date)}` : ''} · ${pr.commitsTotal} total` : `${shortSha(pr.headSha)}`}
        </Text>,
      ]),
    },
  ]

  return (
    <Box flexDirection="row" flexWrap="wrap" gap={1}>
      {list.map(tile => {
        const isOpen = props.ui.section === tile.id
        return (
          <Box
            key={`tile-${tile.id}`}
            position="relative"
            flexDirection="column"
            flexGrow={1}
            width={0}
            minWidth={18}
            paddingX={1}
            borderStyle="round"
            borderColor={isOpen ? TILE_HOVER_EDGE : CARD_EDGE}
            backgroundColor={isOpen ? TILE_HOVER : CARD_BG}
            hover={{ backgroundColor: TILE_HOVER, borderColor: TILE_HOVER_EDGE }}
          >
            <Box flexDirection="row" gap={1} alignItems="center">
              <Text color={DIM}>{tile.glyph}</Text>
              <Text color={TEXT} bold hover={{ color: '#ffffff' }}>
                {tile.title}
              </Text>
              <Text color={DIM}>{isOpen ? '▾' : ''}</Text>
            </Box>
            {tile.summary}
            {clickArea(props, tile.id)}
          </Box>
        )
      })}
    </Box>
  )
}

/**
 * The whole tile takes the click, as in effortless: a Button is one line high, so blank plain ones are laid over the
 * tile's top, middle and bottom in an absolute layer. Each sits in a clipping box so a narrow tile does not shrink it to "…".
 */
function clickArea(props: CardProps, id: CardSection): RenderElement {
  const { Box, Button } = props.els
  return (
    <Box position="absolute" top={0} bottom={0} left={0} right={0} flexDirection="column" justifyContent="space-between">
      {['', '-2', '-3'].map(n => (
        <Box key={`tile-hit-box-${id}${n}`} flexDirection="row" justifyContent="center" overflow="hidden">
          <Box flexShrink={0}>
            <Button
              key={`tile-${id}${n}`}
              plain
              hover={{ backgroundColor: '#00000000' }}
              label={' '.repeat(60)}
              onPress={() => props.actions.toggleSection(id)}
            />
          </Box>
        </Box>
      ))}
    </Box>
  )
}
