---
name: session-resume
description: Read the most recent session note for the current project from the user's Obsidian vault before starting work. Use at the start of any substantial work session, or when the user says "resume", "what were we doing", or "catch me up".
tools: Read, Bash
---

# Session Resume

Load context from the last session note before starting work, so nothing is
repeated or forgotten. Pairs with the `session-note` skill, which writes the notes.

## Steps

1. **Identify the project** from the working directory or the user's first
   message. If the user names a different project than the directory suggests,
   use theirs.
2. **Find the folder** the same way `session-note` does: the vault is
   `$OBSIDIAN_VAULT` if set, otherwise `~/vault`, and the project folder is
   `<vault>/02-research/<project-slug>/`.
3. **Find the most recent session file:**
   `ls -t <vault>/02-research/<slug>/*-session.md | head -5`
4. **Read the most recent file**, focusing on:
   - The open-items section, highest priority. Match the heading tolerantly:
     anything matching `^## (Still )?[Oo]pen / next` (canonical: `## Open / next`).
   - `## What changed`, for traceability.
   - Any commit hashes mentioned.
5. **Report back** in this format:

```markdown
## Last session: YYYY-MM-DD
**What was done:** [one sentence]
**Open items:**
- [item]
**Last commits:** [hashes if present]
**Ready to continue:** [yes / or what's needed first]
```

6. If there's no session note for this project, say so and offer to look
   through the rest of the vault instead.

## Notes

- Read only: never modify vault files.
- If the last session was today, still read it; same-day context matters.
