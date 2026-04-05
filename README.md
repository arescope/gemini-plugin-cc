# Gemini plugin for Claude Code

Use Gemini CLI from inside Claude Code for code reviews, whole-codebase analysis, or to delegate tasks.

This plugin is for Claude Code users who want to leverage Gemini's **1M token context window** alongside Claude Code's coding capabilities — giving you a "satellite view" of your codebase plus hands-on implementation power.

## Install

### From the personal plugin marketplace

> **Note:** This plugin is pending approval for the official Claude Code marketplace. Until then, install from the personal marketplace below.

**Step 1** — Add the marketplace registry:
```
/plugins marketplace add arescope/claude-plugins
```

**Step 2** — Install the Gemini plugin from the registry.

### From GitHub URL (direct)
```
/install-plugin https://github.com/arescope/gemini-plugin-cc
```

### From source (local development)
```bash
git clone https://github.com/arescope/gemini-plugin-cc.git
cd your-project
claude --plugin-dir /path/to/gemini-plugin-cc
```

### Prerequisites

1. Install Gemini CLI: `npm install -g @google/gemini-cli`
2. Authenticate: API key from [AI Studio](https://aistudio.google.com/apikey) or `gemini auth` for OAuth

Then verify:
```
/gemini:setup
```

## What You Get

- `/gemini:review` — code review with full codebase context
- `/gemini:challenge` — challenge review that questions design decisions
- `/gemini:analyze` — whole-codebase analysis (architecture, patterns, security, dependencies)
- `/gemini:consult` — consult Gemini on a task or delegate work
- `/gemini:setup` — check installation, auth, and manage the review gate
- `/gemini:status`, `/gemini:result`, `/gemini:cancel` — manage background jobs
- `gemini-consult` subagent — fires proactively for second opinions or delegation

## Architecture

All commands route through a single Node.js companion entry point (`scripts/gemini-companion.mjs`). Zero external dependencies — Node.js builtins only.

```
/gemini:review --background --base main
  → companion.mjs review --background --base main
    → resolves review target via git.mjs
    → loads prompt template via prompts.mjs
    → spawns detached task-worker
      → runs gemini CLI with structured output
      → parses JSON against schema
      → writes result to .gemini-tasks/state.json
```

### Module library (`scripts/lib/`)

| Module | Purpose |
|--------|---------|
| `args.mjs` | Parse slash-command arguments |
| `fs.mjs` | Filesystem helpers (stdin, JSON) |
| `gemini.mjs` | Gemini CLI wrapper — alias resolution, effort mapping, output parsing |
| `git.mjs` | Git helpers — repo check, review target, context collection |
| `job-control.mjs` | Job lifecycle — sort, resolve, snapshot |
| `process.mjs` | Process management — binary check, tree kill |
| `prompts.mjs` | Template loader with `{{VAR}}` interpolation |
| `render.mjs` | Output formatting — review results, status tables, setup reports |
| `state.mjs` | Centralized JSON state per workspace |
| `tracked-jobs.mjs` | Job execution with progress tracking and log files |
| `workspace.mjs` | Resolve workspace root from cwd |
| `types.d.ts` | TypeScript type definitions for all interfaces |

### Session lifecycle

Three hooks via `hooks/hooks.json`:
- **SessionStart** — propagates session ID to state
- **SessionEnd** — kills running jobs, cleans up session state
- **Stop** — smart review gate (skips turns that didn't make code edits)

## Requirements

| Requirement | Minimum | Recommended |
|-------------|---------|-------------|
| **Node.js** | 18.0+ | 22 LTS |
| **Claude Code** | Latest | Latest |
| **Gemini CLI** | 0.36.0+ | Latest |
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
```

### Background Tasks
```
/gemini:consult --background investigate the flaky integration test
/gemini:status
/gemini:result
```

### Natural Language Delegation
Just ask Claude:
```
Ask Gemini to review these changes as an external peer
Have Gemini analyze the authentication flow across the entire codebase
```

## Review Gate (Stop Hook)

The review gate auto-reviews Claude's code changes before each stop — powered by Gemini. It skips turns that didn't make code edits.

```
/gemini:setup --enable-review-gate    # Enable
/gemini:setup --disable-review-gate   # Disable
```

Configuration is stored in `.gemini-tasks/state.json` via the companion runtime.

**Warning**: This can create a Claude/Gemini loop and may drain usage limits. Only enable when actively monitoring.

## Model Aliases

All commands accept short model names via `--model`:

| Alias | Model | Use case |
|-------|-------|----------|
| `flash`, `fast` | gemini-3-flash-preview | Fastest (default) |
| `pro`, `deep` | gemini-3.1-pro-preview | Most capable |
| `lite` | gemini-2.5-flash-lite | Cheapest |
| `flash-2` | gemini-2.5-flash | Previous gen fast |
| `pro-2` | gemini-2.5-pro | Previous gen capable |

```
/gemini:review --model pro
/gemini:consult --model flash --effort low quick check
```

## Effort Levels

Effort levels via `--effort` (reserved for future Gemini CLI support):

| Level | Budget |
|-------|--------|
| `low`, `l` | Light reasoning |
| `medium`, `med`, `m` | Standard |
| `high`, `h` | Deep reasoning |
| `xhigh`, `max` | Maximum |
| `none`, `off` | No thinking |
| `<number>` | Exact token count |

```
/gemini:analyze --effort high     # Deep reasoning
/gemini:consult --effort low       # Quick pass
```

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
# Node.js unit + integration tests (76 tests)
node --test tests/args.test.mjs tests/gemini.test.mjs tests/git.test.mjs \
  tests/process.test.mjs tests/render.test.mjs tests/state.test.mjs \
  tests/commands.test.mjs tests/runtime.test.mjs

# Structure validation (91 checks)
bash tests/test-plugin-structure.sh
```

## License

Apache-2.0
