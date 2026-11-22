# Gemini plugin for Claude Code

[![CI](https://github.com/arescope/gemini-plugin-cc/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/arescope/gemini-plugin-cc/actions/workflows/ci.yml)
[![Version](https://img.shields.io/github/package-json/v/arescope/gemini-plugin-cc)](package.json)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)
[![Node](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Fraw.githubusercontent.com%2Farescope%2Fgemini-plugin-cc%2Fmain%2Fpackage.json&query=%24.engines.node&label=node)](package.json)
![Platforms](https://img.shields.io/badge/platform-linux%20%7C%20macos%20%7C%20windows-lightgrey)
[![Claude Code plugin](https://img.shields.io/badge/Claude%20Code-plugin-D97757)](https://github.com/arescope/claude-plugins)
[![Requires agy](https://img.shields.io/badge/requires-Antigravity%20CLI%20%28agy%29-4285F4)](https://antigravity.google/docs/cli/)
[![Last commit](https://img.shields.io/github/last-commit/arescope/gemini-plugin-cc)](https://github.com/arescope/gemini-plugin-cc/commits/main)

Use Gemini models from inside Claude Code for code reviews, whole-codebase analysis, or to delegate tasks. The plugin drives Google's [Antigravity CLI](https://antigravity.google/docs/cli/) (`agy`) in headless mode.

This plugin is for Claude Code users who want to leverage Gemini's **1M token context window** alongside Claude Code's coding capabilities — giving you a "satellite view" of your codebase plus hands-on implementation power.

## Install

### From the plugin marketplace (recommended)
```
/plugin marketplace add arescope/claude-plugins
/plugin install gemini@arescope-plugins
```

### From source (local development)
```bash
git clone https://github.com/arescope/gemini-plugin-cc.git
cd your-project
claude --plugin-dir /path/to/gemini-plugin-cc
```

### Prerequisites

1. Install the Antigravity CLI:
   - macOS / Linux: `curl -fsSL https://antigravity.google/cli/install.sh | bash`
   - Windows (PowerShell): `irm https://antigravity.google/cli/install.ps1 | iex`
2. Authenticate, either:
   - run `agy` once interactively and sign in with Google, or
   - set `GEMINI_API_KEY` (from [AI Studio](https://aistudio.google.com/apikey)).

Then verify:
```
/gemini:setup
```

## What You Get

- `/gemini:review` — code review with full codebase context
- `/gemini:challenge` — challenge review that questions design decisions
- `/gemini:analyze` — whole-codebase analysis (architecture, patterns, security, dependencies)
- `/gemini:consult` — consult Gemini on a task or delegate work (runs as a tracked job: visible in `/gemini:status`, stoppable with `/gemini:cancel`)
- `/gemini:setup` — check installation, auth, and manage the review gate
- `/gemini:status`, `/gemini:result`, `/gemini:cancel` — manage background jobs
- `gemini-consult` subagent — fires proactively for second opinions or delegation; read-only unless you ask for changes, and tracked like any background job

## Architecture

All commands route through a single Node.js companion entry point (`scripts/gemini-companion.mjs`). Zero external dependencies — Node.js builtins only.

```
/gemini:review --background --base main
  → companion.mjs review --background --base main
    → resolves review target via git.mjs
    → loads prompt template via prompts.mjs
    → spawns detached task-worker
      → writes the prompt to .gemini-tasks/<job>.prompt, spawns a detached task-worker
        → sends the prompt to `agy` on stdin (stream-json), reads its result event
        → writes the response to .gemini-tasks/<job>.json, status to state.json
/gemini:result
  → renders the stored response (reviews are parsed against the review schema)
```

Design points:

- **Failures are failures.** Auth errors, quota errors, unknown models, timeouts and non-zero exits make the command exit 1 with agy's own message (background jobs end as `error`). Nothing is ever reported as a successful empty result.
- **Prompts travel on stdin**, never argv — no size limit on large diffs, no shell quoting on any platform.
- **Read-only unless you say otherwise.** agy's headless default is Auto mode, which edits files without asking. The plugin pins every run to agy's default mode with review-required permissions (`config/read-only.settings.json`), so file edits and shell commands are denied. Only `--write` lifts that, via `--dangerously-skip-permissions`. The overlay sets two documented agy settings (`agentMode: ""`, `toolPermission: "request-review"`); as a safety net the plugin also checks the permission mode agy reports when a run starts and fails the run if it is not `request-review` (`agy did not honour read-only mode … check git status`), or if agy reports no permission mode at all.
- **Safe flag handling.** User-supplied values reach agy as `--flag=value` (`--add-dir`, `--model`, `--effort`, `--conversation`), so they can never be parsed as flags. Model, effort and conversation values containing whitespace are rejected, and empty `--dirs` entries are ignored.
- **`/gemini:setup` is cheap and honest.** It first runs `agy models` (no model call) to detect a missing sign-in, then sends one short test prompt that must be answered exactly `OK`. Errors that are not about authentication (quota, network, model) are shown as they are. With `GEMINI_API_KEY` set the `agy models` check is skipped.
- **State is self-contained.** `.gemini-tasks/` carries its own `.gitignore`, writes are atomic, and only the 50 most recent finished jobs are kept.
- **Jobs belong to sessions.** The worker's PID and the Claude Code session ID are recorded, so `/gemini:cancel` and session end terminate exactly the right process group. A job whose worker died is reported as failed, not left "running".
- **Reviews see new files.** Untracked text files are included in working-tree reviews (up to 50 files, 200 KB each), not just the tracked diff.

### Module library (`scripts/lib/`)

| Module | Purpose |
|--------|---------|
| `args.mjs` | Parse slash-command arguments |
| `agy.mjs` | Antigravity CLI wrapper — model and effort resolution, headless invocation, result parsing |
| `git.mjs` | Git helpers — repo check, review target, context collection |
| `job-control.mjs` | Job lifecycle — sort, resolve, snapshot, orphan detection |
| `process.mjs` | Process management — binary check, tree kill |
| `prompts.mjs` | Template loader with `{{VAR}}` interpolation |
| `render.mjs` | Output formatting — review results, status tables, setup reports |
| `state.mjs` | Atomic JSON state per workspace, job retention |
| `tracked-jobs.mjs` | Job records, session attribution, progress log files |
| `workspace.mjs` | Resolve workspace root from cwd |

### Session lifecycle

Three hooks via `hooks/hooks.json`:
- **SessionStart** — exports the session ID (`GEMINI_COMPANION_SESSION_ID`) to the session's shell environment
- **SessionEnd** — terminates background jobs started by that session
- **Stop** — optional review gate (off by default; see below)

## Requirements

| Requirement | Minimum | Recommended |
|-------------|---------|-------------|
| **Node.js** | 20.0+ | 24 LTS |
| **Claude Code** | Latest | Latest |
| **Antigravity CLI (`agy`)** | 1.5.7+ | Latest (built against 1.5.9) |
| **Git** | 2.0+ | Latest |
| **OS** | Windows, macOS, Linux | — |

## Usage

### Review Before Shipping
```
/gemini:review --base main
```

### Challenge Your Design
```
/gemini:challenge --base main question the retry and error handling strategy
```

### Understand the Architecture
```
/gemini:analyze Map the system architecture, key abstractions, and data flow
```

### Delegate a Task
```
/gemini:consult investigate why the build is failing in CI
/gemini:consult --resume-last now fix the second issue you found
```

`--resume-last` continues the conversation of the most recent `task` run in this workspace, and only that: reviews, analyses and the stop gate never affect it, and a task that started earlier never overwrites a newer one's thread. It fails with a clear message if there is nothing to resume. If the recorded conversation no longer exists in agy, run the task without `--resume-last` to start a new one and reset the pointer.

### Background Jobs
```
/gemini:review --background --base main
/gemini:analyze --background security audit of the payment module
/gemini:status                 # table of recent jobs
/gemini:status <job-id>        # details + recent log lines
/gemini:result [job-id]        # output of the latest (or given) finished job
/gemini:cancel [job-id]
```

Runs time out after 10 minutes by default; set `GEMINI_COMPANION_TIMEOUT_MS` to change that for very large codebases.

### Natural Language Delegation
Just ask Claude:
```
Ask Gemini to review these changes as an external peer
Have Gemini analyze the authentication flow across the entire codebase
```

## Review Gate (Stop Hook)

The review gate has Gemini review Claude's uncommitted changes before Claude stops, and sends Claude back to work if Gemini finds a blocking issue.

- Runs only when the working tree has uncommitted changes that the gate has not already reviewed — unchanged trees and clean trees cost nothing.
- A block triggers at most one follow-up Claude turn; the gate never re-fires on a stop it caused, so it cannot loop.
- If Gemini is unavailable (auth, quota) the gate fails open with a visible warning and retries on the next stop.
- A review that times out (780s by default; set `GEMINI_GATE_TIMEOUT_MS` to change it) is **not** retried for the same changes, so a slow review cannot cost minutes on every stop — run `/gemini:review --background` for those. An empty reply allows silently.
- The gate must never edit your tree: if agy does not honour read-only mode, the gate shows a prominent warning and never blocks.

```
/gemini:setup --enable-review-gate    # Enable
/gemini:setup --disable-review-gate   # Disable
```

Configuration is stored in `.gemini-tasks/state.json` via the companion runtime.

**Note**: every gated stop is a Gemini request and can add up to a few minutes of latency. Enable it for sessions where you want that second check, not globally by habit.

## Model Aliases

All commands accept short model names via `--model`:

| Alias | Model slug passed to `agy` | Use case |
|-------|----------------------------|----------|
| *(none)* | — (your `agy` default model) | Default |
| `argon`, `pro` | `gemini-4-argon` | Gemini 4 Argon — default choice for most engineering work |
| `carbon`, `deep` | `gemini-4-carbon` | Gemini 4 Carbon — frontier model for deep, complex tasks |
| `hydrogen` | `gemini-4-hydrogen` | Gemini 4 Hydrogen — fast and efficient |
| `flash`, `fast`, `lite` | `gemini-3.8-flash` | Gemini 3.8 Flash — fastest and cheapest |

Any other value is passed to `agy` unchanged, so every slug from `agy models` works (for example `gemini-4-argon-high`). Which models you see depends on how you are signed in. An unknown model fails with agy's error and its list of available models — it never silently falls back.

```
/gemini:review --model argon
/gemini:challenge --model carbon --effort high
/gemini:consult --model flash --effort low quick check
```

## Effort Levels

`--effort` sets the model's reasoning effort and is passed straight to `agy --effort`:

| Level | Short forms |
|-------|-------------|
| `low` | `l` |
| `medium` | `med`, `m` |
| `high` | `h` |
| `xhigh` | `xh` |
| `max` | — |

Not every model supports every level (Hydrogen goes up to `xhigh`, Argon offers `medium` and `high`); agy rejects an unsupported combination with a clear error. Without `--effort`, agy uses the model's default level.

## Internal Skills

Three internal skills guide agent behavior (not user-invocable):

| Skill | Purpose |
|-------|---------|
| `gemini-cli-runtime` | Contract for calling the companion from agents |
| `gemini-result-handling` | Rules for presenting Gemini output |
| `gemini-prompting` | Guidance for composing XML-tagged prompts |

Plus `guide` — a quick reference for all commands and options.

## Testing

```bash
npm ci

# Unit + end-to-end tests against a fake gemini binary (no network, no API key)
npm test

# Type-check the JSDoc-annotated sources
npm run typecheck

# Structure validation
npm run test:structure
```

## License

Apache-2.0
