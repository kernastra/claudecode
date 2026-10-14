# claudecode — mods, skills and MCP apps for Claude Code

<p align="center">
  <img src="docs/assets/hero.png" alt="claudecode — mods, skills and MCP apps for Claude Code" width="100%" />
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT" /></a>
  <a href="https://claude.com/claude-code"><img src="https://img.shields.io/badge/Built%20for-Claude%20Code-d97757.svg" alt="Built for Claude Code" /></a>
  <a href="https://modelcontextprotocol.io/"><img src="https://img.shields.io/badge/MCP-Apps-7b3cf2.svg" alt="MCP Apps" /></a>
</p>

<p align="center">
  <a href="#features"><b>What's inside</b></a> ·
  <a href="#getting-started"><b>Getting started</b></a> ·
  <a href="#usage"><b>Usage</b></a> ·
  <a href="#roadmap"><b>Roadmap</b></a>
</p>

## Overview

`claudecode` is a collection of add-ons that make Claude Code feel less like a chat window and more like a developer workstation. **Mods** put live information right in your session, such as a pull request card under the push that created it, a usage bar above the prompt, or a tree of what your subagents are doing. **MCP apps** bring interactive cards into ChatGPT and Claude conversations. **Skills** teach Claude repeatable workflows. Everything here is open source and meant to be forked, tweaked and made your own.

## Features

### MCP apps

<table>
  <tr>
    <td width="96" align="center"><img src="mcps/pulltile/brand/export/pulltile-128.png" width="72" alt="Pulltile icon" /></td>
    <td>
      <b><a href="mcps/pulltile">Pulltile</a></b> · <i>available</i><br />
      Your GitHub pull requests as cards in ChatGPT and Claude. Expand a card for checks, changed files, commits and review feedback, then review or merge without leaving the chat. Each user signs in with their own GitHub account.
    </td>
  </tr>
</table>

### Mods

Mods run inside Claude Code itself, in the terminal and the desktop app's Code tab.

| Mod | What it does | Status |
|---|---|---|
| **[pr-card](mods/pr-card)** | Your pull request inside Claude Code: an inline card with checks, reviews and unresolved threads, **Fix with Claude** for review feedback, a PR bar above the prompt and a details pane | **Available** |
| **[usage-bar](mods/usage-bar)** | Your plan's usage limits and context fill above the prompt, with reset countdowns and a seasonal theme | **Available** |
| **[subagent-monitor](mods/subagent-monitor)** | A live tree of running subagents: what each one is doing, how long it has run and what it costs | Coming soon |
| **[context-guardian](mods/context-guardian)** | Tracks decisions and checkpoints in long sessions and writes a handoff note before context runs out | Planned |

### Skills

Reusable Claude Code skills for recurring workflows live in [`skills/`](skills). The first ones are on the way.

## Requirements

- **Claude Code** — for mods and skills, a recent version with function-hook mods enabled (the mod API is early access)
- **Node.js 24.18+** — for running MCP apps locally
- **GitHub CLI (`gh`)**, signed in — used by the pull request mods
- **A ChatGPT or Claude account with custom connectors** — to use MCP apps in chat

Each item's own README lists anything extra it needs.

## Getting Started

### Installation

```bash
git clone https://github.com/kernastra/claudecode.git
```

```bash
cd claudecode
```

Then follow the README of whatever you want to use:

| Type | Where | How it's installed |
|---|---|---|
| MCP app | `mcps/<name>` | `npm install`, configure `.env`, run or deploy it, then add its URL as a connector in ChatGPT or Claude |
| Mod | `mods/<name>` | Point Claude Code at the folder with `--plugin-dir` or the `CLAUDE_CODE_PLUGIN_DIRS` setting |
| Skill | `skills/<name>` | Copy the folder into `~/.claude/skills/` |

## Usage

**Try Pulltile on your own account in a couple of minutes:**

```bash
cd mcps/pulltile
```

```bash
npm install
```

```bash
SKYBRIDGE_SINGLE_USER=1 npm run dev
```

Open `http://localhost:3000`, pick `list-pull-requests` and click **Run** to see your pull requests as cards. To use it in ChatGPT or Claude with sign-in for other people, follow the setup in the [Pulltile README](mcps/pulltile#configuration).

**Load a mod for one session**, for example the usage bar:

```bash
claude --plugin-dir ./mods/usage-bar
```

<!-- ===== Repo-Specific Sections ===== -->

## Project Structure

```text
claudecode/
├── mcps/                  # MCP apps for ChatGPT and Claude
│   └── pulltile/          # GitHub pull requests as cards
├── mods/                  # In-session add-ons for Claude Code
│   ├── pr-card/
│   ├── usage-bar/
│   ├── subagent-monitor/
│   └── context-guardian/
├── skills/                # Claude Code skills
└── docs/assets/           # README images
```

## Roadmap

- **Publish the subagent monitor** — it already runs day to day and is being cleaned up for release
- **Context Guardian** — session checkpoints and handoff notes for long-running work
- **First skills** — packaged workflows for reviews, releases and session notes

Ideas and pull requests are welcome; open an issue to talk through anything bigger.

## License

This project is licensed under the MIT License — see [LICENSE](LICENSE) for details.

<sub>A community project, not affiliated with or endorsed by Anthropic. Claude and Claude Code are trademarks of Anthropic.</sub>
