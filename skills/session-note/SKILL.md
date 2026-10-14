---
name: session-note
description: Write or append a dated session note to the user's Obsidian vault summarizing the current work session. Use when the user asks to "save a session note", "log this session", "update the vault", or at a natural end of a substantial work session.
---

# Session Note

Summarize the current work session into a dated note in the user's Obsidian vault
so either of you can pick up where you left off later. Run when asked, or offer at
a natural end of substantial work.

## Where notes go

- **Vault:** `$OBSIDIAN_VAULT` if set, otherwise `~/vault`.
- **Folder:** `<vault>/02-research/<project-slug>/`, where `<project-slug>` is the
  project's name in lowercase-kebab (e.g. `my-app`). If the user's vault keeps
  project notes somewhere else and they've told you where, use that instead.
- **File:** `YYYY-MM-DD-session.md`.

## Steps

1. **Date** — today's date (`date +%F` → `YYYY-MM-DD`).

2. **Project & repo** — identify what was worked on this session. If work
   happened in a git repo, capture the commit hashes created this session
   (`git -C <repo> log --oneline -<n>`), since notes must be traceable.

3. **Folder** — if the project folder doesn't exist yet, create it and mention
   that you did. If the session spanned several projects, write one note per
   project.

4. **File** — if `YYYY-MM-DD-session.md` does **not** exist, create it with the
   template below. If it **already exists** (an earlier session today), append a
   new `## <HH:MM> — <topic>` section. Never overwrite existing content.

5. **Write the note** in plain markdown: dated heading, backticked file paths,
   commit hashes inline. Be concise but complete; favor traceability over prose.

6. **Confirm** the path written and a one-line summary. Obsidian reads the folder
   live, so no commit step is needed unless the user asks.

## Template (new file)

```markdown
---
date: YYYY-MM-DD
project: <Project Name>
tags: [<slug>, session-notes, claude-code]
---

# <Project Name> — Session Notes — YYYY-MM-DD

<Repo / clone path / production URL, if relevant.>

## Summary

<2-4 sentences: what we set out to do and the net outcome.>

## What changed

- **<change>** — <what & why>. (commit `<hash>`)

## Key facts (don't re-derive)

- <stable fact discovered this session that future sessions should not re-derive>

## Open / next

- <unfinished or follow-up items>
```

## Notes

- Scale to the session: a few bullets for a small session, more for a large one.
- Don't invent detail you're unsure of; note the uncertainty instead.
- Keep the `## Open / next` heading as is: the `session-resume` skill looks for it.
