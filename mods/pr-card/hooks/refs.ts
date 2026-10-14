// Pure parsing: git remotes, PR references, and the shell commands that should surface a card.

export type RepoId = { owner: string; repo: string }
export type PrRef = RepoId & { number: number }
export type Remote = { name: string; url: string }

const NAME = '[A-Za-z0-9_.-]+'

/** `owner/repo` of a github.com remote in any common spelling, or null for another host. */
export function parseGitHubRemote(url: string): RepoId | null {
  const trimmed = url.trim()
  const patterns = [
    // https://github.com/o/r(.git), with or without credentials or a trailing slash
    new RegExp(`^(?:https?|git)://(?:[^@/]+@)?(?:www\\.)?github\\.com(?::\\d+)?/(${NAME})/(${NAME}?)(?:\\.git)?/?$`, 'i'),
    // ssh://git@github.com(:22)/o/r(.git)
    new RegExp(`^ssh://(?:[^@/]+@)?(?:ssh\\.)?github\\.com(?::\\d+)?/(${NAME})/(${NAME}?)(?:\\.git)?/?$`, 'i'),
    // git@github.com:o/r(.git)
    new RegExp(`^(?:[^@/\\s]+@)?github\\.com:(${NAME})/(${NAME}?)(?:\\.git)?/?$`, 'i'),
  ]
  for (const pattern of patterns) {
    const match = trimmed.match(pattern)
    if (match && match[1] && match[2]) return { owner: match[1], repo: match[2].replace(/\.git$/i, '') }
  }
  return null
}

/** `git remote -v` output as (name, url) pairs, fetch and push folded, order kept. */
export function parseRemotes(output: string): Remote[] {
  const seen = new Map<string, string>()
  for (const line of output.split('\n')) {
    const match = line.match(/^(\S+)\s+(\S+)(?:\s+\((fetch|push)\))?\s*$/)
    if (!match) continue
    if (!seen.has(match[1]!)) seen.set(match[1]!, match[2]!)
  }
  return [...seen].map(([name, url]) => ({ name, url }))
}

/**
 * The GitHub repositories a branch's PR may live in, most likely first: `upstream`
 * (the base of a fork), then `origin`, then the rest. Duplicates collapse.
 */
export function candidateRepos(remotes: Remote[]): Array<RepoId & { remote: string }> {
  const rank = (name: string) => (name === 'upstream' ? 0 : name === 'origin' ? 1 : 2)
  const out: Array<RepoId & { remote: string }> = []
  for (const remote of [...remotes].sort((a, b) => rank(a.name) - rank(b.name))) {
    const id = parseGitHubRemote(remote.url)
    if (!id) continue
    if (out.some(one => sameRepo(one, id))) continue
    out.push({ ...id, remote: remote.name })
  }
  return out
}

export function sameRepo(a: RepoId, b: RepoId): boolean {
  return a.owner.toLowerCase() === b.owner.toLowerCase() && a.repo.toLowerCase() === b.repo.toLowerCase()
}

export function keyOf(ref: PrRef): string {
  return `${ref.owner}/${ref.repo}#${ref.number}`
}

export function refOfKey(key: string): PrRef | null {
  const match = key.match(new RegExp(`^(${NAME})/(${NAME})#(\\d+)$`))
  return match ? { owner: match[1]!, repo: match[2]!, number: Number(match[3]) } : null
}

export type ParsedArg =
  | { kind: 'none' }
  | { kind: 'ref'; ref: PrRef }
  | { kind: 'number'; number: number }
  | { kind: 'invalid'; text: string }

/** What `/pr` was given: nothing, `123`, `#123`, `owner/repo#123`, or a PR URL. */
export function parsePrArg(raw: string): ParsedArg {
  const text = raw.trim()
  if (!text) return { kind: 'none' }
  const number = text.match(/^#?(\d{1,9})$/)
  if (number) return { kind: 'number', number: Number(number[1]) }
  const short = refOfKey(text)
  if (short) return { kind: 'ref', ref: short }
  const url = findPrUrls(text)[0]
  if (url) return { kind: 'ref', ref: url }
  return { kind: 'invalid', text: text.slice(0, 80) }
}

/** Every github.com PR URL in `text`, in order, without duplicates. */
export function findPrUrls(text: string): PrRef[] {
  const out: PrRef[] = []
  const pattern = new RegExp(`https://(?:www\\.)?github\\.com/(${NAME})/(${NAME})/pull/(\\d+)`, 'g')
  for (const match of text.matchAll(pattern)) {
    const ref = { owner: match[1]!, repo: match[2]!, number: Number(match[3]) }
    if (!out.some(one => keyOf(one) === keyOf(ref))) out.push(ref)
  }
  return out
}

/** Splits a shell line into its simple commands, so `cd x && git push` finds the push. */
function segments(command: string): string[] {
  return command.split(/&&|\|\||;|\||\n/).map(part => part.trim())
}

/** `git [-C dir] [-c k=v] push ...` anywhere in the line. Excludes `--dry-run`. */
export function isGitPush(command: string): boolean {
  return segments(command).some(
    part => /^(?:\S+=\S+\s+)*git(?:\s+(?:-C\s+\S+|-c\s+\S+))*\s+push\b/.test(part) && !/\s(?:--dry-run|-n)\b/.test(part),
  )
}

export function isPrCreate(command: string): boolean {
  return segments(command).some(part => /^gh\s+pr\s+create\b/.test(part))
}

export function isPrView(command: string): boolean {
  return segments(command).some(part => /^gh\s+pr\s+(?:view|checks|status|ready)\b/.test(part))
}

/**
 * Commands that change a PR, the remote, or discard work: during a Fix with Claude turn
 * each one goes back to the person for approval, whatever the session's rules allow.
 */
export function isSensitiveDuringFix(command: string): string | null {
  for (const part of segments(command)) {
    if (/^(?:\S+=\S+\s+)*git(?:\s+(?:-C\s+\S+|-c\s+\S+))*\s+push\b/.test(part)) return 'pushes to the remote'
    if (/^gh\s+pr\s+(?:merge|review|close|comment|edit|ready)\b/.test(part)) return 'changes the pull request on GitHub'
    if (/^gh\s+api\b/.test(part) && /(resolveReviewThread|addPullRequestReview|mergePullRequest|-X\s*(?:POST|PATCH|PUT|DELETE)|--method\s+(?:POST|PATCH|PUT|DELETE))/i.test(part))
      return 'writes through the GitHub API'
    if (/^git\s+(?:reset\s+--hard|clean\s+-[a-z]*f|checkout\s+--?\s|checkout\s+\S|switch\b|rebase\b|branch\s+-D)/.test(part))
      return 'changes or discards local git state'
  }
  return null
}
