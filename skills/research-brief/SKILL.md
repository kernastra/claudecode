---
name: research-brief
description: Use when asked to research a person, tool, idea, framework, movement, or topic in depth and produce a styled HTML brief. Triggers include "deep dive into X", "research X and report back", "give me a brief on X", "who is X and how does it apply to us", or any request combining research + HTML/report output.
tools: WebSearch, WebFetch, Write, Bash, Read
---

# Research Brief

Deep-research a subject across multiple sources, then produce a self-contained
dark-mode HTML brief saved to `<briefs>/<slug>-brief.html`, where `<briefs>` is
`$BRIEFS_DIR` if set, otherwise `~/docs/briefs` (create it if needed).

---

## Steps

### 1. Clarify (if not given)

Ask, or infer from context:
- **Subject** — who or what exactly? (person, tool, concept, framework)
- **Angle** — what aspect matters most? (philosophy, technical approach, business model, history)
- **Application context** — which of the user's projects should this be applied to?
  Look at the working directory and any project docs (README, CLAUDE.md) first,
  and ask only if it's still unclear.

If the request makes these clear, skip asking and proceed.

### 2. Wave 1 — Broad parallel searches (3 at once)

Run three web searches at once, each from a different angle:

```
Search 1: "<subject> philosophy OR framework OR principles <year>"
Search 2: "<subject> <domain> tools OR techniques OR approach"
Search 3: "<subject> named concepts OR key ideas OR mental models"
```

Collect the URLs and pick 2–4 worth fetching.

### 3. Wave 1 — Parallel fetches

Fetch the most information-dense pages at once (homepage, docs, GitHub README,
key article). Extract:
- Named frameworks and models
- Core principles and philosophy
- Specific quotes worth keeping
- Any structured lists, tables, or hierarchies

### 4. Wave 2 — Fill gaps

Based on what's missing, run 1–2 more targeted searches and fetch 1–2 more pages.
Common gaps: specific video or article content, a named concept that needs
clarifying, application examples or case studies.

### 5. Synthesize → HTML brief

Adapt `template.html` in this skill's directory. Design system: Archivo
(headlines) + Space Mono (codes) + Inter (body), amber/ink palette, hazard-stripe
placards, gauge cluster, table-of-contents sidebar, scroll-reveal sections and a
dark-mode toggle. Replace every `{{PLACEHOLDER}}`; keep all CSS intact. Only
change accent colors if the subject has strong brand colors.

**Required sections** (scale depth to the material):

| Section | What goes here |
|---|---|
| Header | Subject name, subtitle, badge row of key figures |
| Background | Who or what the subject is, in a lead paragraph and 3 points |
| Core Philosophy | A real quote in the placard, plus 1–2 explanation cards |
| Core Frameworks | The central model or framework, as a ranked list |
| Named Concepts | Table: name, what it is, why it matters |
| Applied to Our Stack | One `apply` block per project or use case |
| Key Takeaways | 3–5 cards: what's worth remembering a month from now |
| Sources | Every URL actually fetched |

In "Applied to Our Stack", be specific: not "this could apply to my-app" but
"use X pattern for the Y feature in my-app".

### 6. Save the file

Save to `<briefs>/<subject-slug>-brief.html`, where `<subject-slug>` is
lowercase-kebab (e.g. `context-engineering`, `crewai`). Confirm the path.

### 7. Offer a session note

After saving, offer: "Want me to log this research with `/session-note`?"
Don't write it automatically.

---

## Research quality bar

- At least **3 unique source URLs** fetched, not just searched
- At least **one named framework or model** extracted and explained
- The Sources section lists every URL actually fetched

## What not to do

- Don't summarize search snippets as if you'd fetched the pages
- Don't invent frameworks, quotes or credentials; mark uncertainty explicitly
- Don't skip "Applied to Our Stack"; that's the point of the brief
