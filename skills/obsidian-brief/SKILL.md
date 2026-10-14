---
name: obsidian-brief
description: Turn the current Claude Code session into a styled HTML brief and linked Obsidian note. Use when asked to "turn this into a brief", "obsidian brief", "brief this session", "synthesize this into an artifact", or at the end of a focused work session to capture the outcomes as cross-linked docs.
tools: Read, Write, Bash
---

# Obsidian Brief

Synthesize the current work session into TWO linked artifacts: a styled HTML brief
and a dedicated Obsidian vault note. This is SESSION SYNTHESIS ONLY: content comes
from what was worked out in the conversation, not from external research.

Requires the `research-brief` skill, whose `template.html` this skill reuses.

## Locations

- **Vault:** `$OBSIDIAN_VAULT` if set, otherwise `~/vault`.
- **Briefs:** `$BRIEFS_DIR` if set, otherwise `~/docs/briefs`.

## Steps

1. **Determine focus & slug.** If an argument is given (`/obsidian-brief <topic>`),
   use it to set the focus and kebab-case slug. Otherwise, scan the conversation
   for the main thread and summarize it into a focus. If the session belongs to a
   project, use the project's slug (the same one `session-note` uses); otherwise
   use the topic slug. If the focus is ambiguous and no argument was passed, ASK
   the user before proceeding.

2. **Date.** Today's date via `date +%F` → `YYYY-MM-DD`.

3. **Build the HTML brief.** Read `template.html` from the `research-brief` skill
   directory. Keep ALL CSS, fonts (Archivo/Space Mono/Inter), the dark-mode
   toggle, the table-of-contents sidebar and scroll-reveal intact. Populate every
   placeholder PURELY from session content. Because this is synthesis, not
   research, replace the "Sources" section with a short "Basis" note:
   "First-person synthesis of this session; no external sources." Scale sections
   to the material. Save to `<briefs>/<slug>/brief.html`, creating the folder if
   needed.

4. **Build the Obsidian note** at
   `<vault>/02-research/<slug>/YYYY-MM-DD_<topic>-brief.md` (kebab-case topic,
   underscore between date and topic). If the folder doesn't exist, create it and
   say so. Frontmatter: `date: YYYY-MM-DD`, `project: <Project Name>`,
   `tags: [<slug>, obsidian-brief, claude-code]`. Body: a concise summary of the
   focus and the session's key points, then the HTML brief's absolute path in
   backticks.

5. **Cross-link both directions.** The Obsidian note links to the HTML file. The
   brief's footer gets a small line linking BACK to the vault note with an
   `obsidian://open?vault=<vault-name>&file=...` URI, so clicking it opens the
   note in Obsidian. `<vault-name>` is the vault folder's name.

6. **Confirm.** Report the absolute paths of both files and a one-line summary of
   the focus.

---

## Guardrails

- **No web research.** Session content only. Don't search or fetch the web.
- **No invented facts, quotes, credentials or authority claims.** State
  uncertainty explicitly instead.
- **Ask before writing** if the focus is ambiguous and no argument was passed.
- Obsidian reads the vault live, so no commit step is needed unless the user asks.
