# Architecture

## Verified platform capabilities (Claude Code 2.1.288 mod API)

| Need | Supported mechanism | Notes |
| --- | --- | --- |
| Inline card in the conversation | `ui.render` on `CommandOutput` (a slash command's output row) and `ToolResult` (a tool's result block) | Raised on every surface, Desktop included. A hook's tree draws in the row's place at transcript width. |
| Desktop as a first-class target | `e.surface === 'desktop'`, `$.ui.resolve(e)` element table: `Box`, `Text`, `Button`, `Link`, `Markdown`, `Code`, `Svg`, `Input`, `Select`, `Client` | The terminal table lacks `Svg`; the card uses a text glyph there. |
| Theme-following color | `color` / `borderColor` accept theme keys | Keys confirmed from the shipped themes: `success`, `error`, `warning`, `merged`, `inactive`, `subtle`, `diffAdded`, `diffRemoved`. |
| Buttons and keyboard | `Button` raises `ui.press`; focus, Tab and Enter are the host's | |
| Data | `$.process.run(['gh', ...])` | No Node, no DOM in the module; `gh` holds the credentials. |
| Live updates | `$.state` atoms (`read` subscribes the drawing, `update` redraws readers), `$.clock.every/after` | Values survive a hot reload; module variables do not. |
| Fix with Claude | `$.prompt.submit({ text })` | Queues a prompt that starts its own turn when the session is idle; the transcript names the plugin as the sender. |
| Permission enforcement | `tool.call` hook on `Bash` with `$.ui.ask` | The engine's own question dialog; refusal returns `{ deny }` to the model. |
| Push detection | Bash result `gitOperation.push` / `gitOperation.pr` | The engine's own classification, with a command-line parser as fallback. |

Not available: the permission dialog is drawn by the engine alone; there is no API to post into another session.

Reference projects: `anthropics/claude-code/mods` (official built-ins; `diff` is a pane), `mishgoldenberg/claude-mods` (MIT; panes and bands, terminal-first), `meganemura/pull-request-pane` (MIT; PRs in a side pane). None draws a PR card inline in the transcript. No code was copied; the octicon path in `card.tsx` is from GitHub Octicons (MIT).

## Modules

```
hooks/
  register.tsx  hooks: session.start, command.run(pr), tool.call(show_pr_card | Bash),
                prompt.submit, turn.complete, ui.render(CommandOutput | ToolResult)
  card.tsx      renderCard(): pure drawing from (entry, ui state, actions)
  github.ts     GraphQL query, normalizePr(), error classification, redaction
  refs.ts       remotes, /pr arguments, PR URLs, push/create detection, fix-time command guard
  status.ts     per-dimension status: state, checks, reviews, mergeability; model summary
  prompt.ts     Fix with Claude prompt, fencing, permission note, file excerpt
types/index.d.ts  the $.state contract
tests/          logic.test.ts (pure), register.test.ts (engine, both surfaces)
```

## Data flow

```
/pr args ──► resolveTarget ──► discover (git + gh pr list) ──► key "owner/repo#n"
                                                        │
Bash git push / gh pr create ──► attachCard ──► bind(tool_use_id → key)
                                                        │
show_pr_card tool ───────────────────────────► bind ────┤
                                                        ▼
                           refresh(key): gh api graphql ─► normalizePr ─► $.state prs[key]
                                                        │
ui.render (CommandOutput | ToolResult) ── read prs, ui, fix ──► renderCard ──► the surface
```

State (`$.state`, plugin `github-pr-card`):

- `prs`: `key → { data?, error?, fetchedAt?, isLoading, seq, backoffUntil? }`
- `bindings`: `tool_use_id → { key, reason }`, capped at 400
- `ui`: `requestId → { section, thread }`, so each card keeps its own expansion
- `fix`: the one Fix with Claude task, from press until its turn completes

Because every card reads `prs`, a refresh triggered anywhere redraws every card of that PR in the transcript, including older rows.

## Discovery

1. `git rev-parse --show-toplevel`; `git symbolic-ref --short HEAD` (detached HEAD stops here).
2. GitHub remotes ranked `upstream`, `origin`, then others (HTTPS, SSH, `ssh://`, credentials stripped).
3. The head branch and its owner come from `branch.<b>.merge` and the push remote (`branch.<b>.pushRemote`, `remote.pushDefault`, tracking remote), so a fork's PR against upstream is found and a same-named branch from another fork is filtered out.
4. `gh pr list --head <branch> --state open` per candidate repo; if none, `--state all` on the first. One match draws; several draw a picker; none says so.
5. Cached for 30 s per (root, branch, head owner, remotes); `/pr` and Refresh clear it.

## Status model

Each dimension is reduced independently and drawn as its own indicator, so "open, approved, required check pending, merge conflicts" shows as four facts:

- PR state: Open, Draft, Merged, Closed.
- Checks: check runs and commit statuses folded to one vocabulary (queued, in progress, pending, success, failure, error, cancelled, timed out, action required, skipped, neutral, stale, unknown), then bucketed failing > pending > cancelled > unknown > passing > skipped.
- Reviews: approvals and change requests from the latest opinionated review per reviewer, `reviewDecision`, requested reviewers, unresolved threads.
- Merge: `CONFLICTING`/`DIRTY` → conflicts; `BEHIND` → behind base; `UNKNOWN` → "Mergeability pending".

## PR bar and tiles

- `hooks/band.tsx`: the bar above the prompt (`ui.render` on `AbovePrompt`). It calls `next(e)` first and stacks its own box above whatever else draws there. Layout after effortless's dashboard bar: a relative `#141416` rounded box, the art in an absolute layer pinned right (`top=-1 right=0 bottom=-1`, explicit px size, a non-empty `alt`), and content rows made positioned by an empty absolute child so they paint and take clicks above the art.
- The art is CSS animation inside the SVG. The bar redraws constantly while Claude works, so each animated element's `animation-delay` is shifted back by the time since the art first drew; a redraw continues the animation instead of restarting it.
- State `band: { on, key, dismissed }`. `auto` mode shows it 1.5 s after session start for the branch's PR (`discover`), and on create/push; ✕ sets `dismissed` for the session.
- `hooks/card-tiles.tsx`: `/pr-tiles`, the tiles layout; whole-tile clicks are blank `plain` Buttons in an absolute overlay.

## Visual decisions

- Desktop: a `#212121` panel, rounded, its border drawn in the fill color so no edge shows, matching the usage band. The terminal keeps a `subtle` round border.
- Title bold in the host's text color; labels and metadata dim; branch names truncate in the middle, paths at the start.
- Claude orange (`#D97757`) only on the PR icon. Desktop takes the usage band's amber `#E0A23B` and red `#E5534B`; elsewhere the theme keys `warning` and `error`. Passing checks and diff counts use `success`, `diffAdded`, `diffRemoved`.
- One `variant="primary"` button at the bottom right: Show failures, Review N threads, or Refresh. Section toggles are dim.
- Secondary detail is collapsed by default; long comment bodies are cut at 900 characters with a link to GitHub.

## What Desktop does (measured in the app, Desktop 2.19675.1 / Claude Code 2.1.288)

- A slash command's row arrives at `CommandOutput` with the plugin's name in front of the text (`github-pr-card: GitHub PR card: ...`); the card matches its marker anywhere in the first 40 characters.
- Tool rows are drawn through `ToolUse` (carrying `output`), not `ToolResult`, so the card hooks both. Bash rows raise `ToolUse`; this plugin's own `show_pr_card` rows raised no render hook at all.
- `Svg` draws gradients at fixed or 100% size, and a `data:` JPEG inside it when not `isInteractive`. An `isInteractive` Svg draws gradients but blocks the JPEG.
- An `Svg` with `alt=""` is not drawn. With a label, art in a `position="absolute"` layer behind native text works (verified in the PR bar above the prompt); the earlier conclusion that absolute layers are not painted came from a test with an empty alt. The card's image-header version was dropped by design choice.
- The engine checks an Svg's props and its 131,072-character limit and passes the markup through unchanged; the filtering is Desktop's.

## Verification status

- Automated: `claude plugin test` (39 passing), `claude plugin validate`, `tsc` strict.
- Live: `/pr` with a ref and with discovery, in this Desktop session and in a fresh headless session loaded from `CLAUDE_CODE_PLUGIN_DIRS`.
- Real data: the normalizer and status mapping were run against live GitHub responses (an ADMIN-owned PR with 10 required-status-known checks, a draft with conflicts, and a public PR with 14 unresolved Copilot review threads and READ permission).
