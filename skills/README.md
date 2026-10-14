# Skills

Claude Code skills for recurring workflows. Each folder is one skill: copy it into `~/.claude/skills/` and Claude uses it in new sessions.

| Skill | What it does |
|---|---|
| **[session-note](session-note)** | Logs each work session to your Obsidian vault: what changed, commit hashes, open items |
| **[session-resume](session-resume)** | Reads the last session note back and catches you up before work starts |
| **[research-brief](research-brief)** | Researches a topic across sources and writes a designed HTML brief |
| **[obsidian-brief](obsidian-brief)** | Turns a work session into a designed brief plus a linked vault note |
| **[prompt-optimizer](prompt-optimizer)** | Turns a rough image idea into a detailed generation prompt |

`session-note` and `session-resume` work as a pair. `obsidian-brief` needs `research-brief` installed, for its template.
