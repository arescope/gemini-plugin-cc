---
name: guide
description: "Quick reference for Gemini plugin commands, model aliases, effort levels, and review gate configuration. Use when you need a reminder of available options."
disable-model-invocation: true
---

# Gemini Plugin Quick Reference

## Commands

| Command | Purpose |
|---------|---------|
| `/gemini:review` | Code review with full codebase context |
| `/gemini:challenge` | Challenge-oriented design review |
| `/gemini:analyze` | Whole-codebase analysis (1M context) |
| `/gemini:consult` | Delegate tasks to Gemini |
| `/gemini:status` | Check background task progress |
| `/gemini:result` | Get finished task output |
| `/gemini:cancel` | Stop a running task |
| `/gemini:setup` | Check install, auth, manage review gate |

## Model Aliases

Use with `--model` on any command:

| Alias | Model |
|-------|-------|
| `flash`, `fast` | gemini-3-flash-preview (default, fastest) |
| `pro`, `deep` | gemini-3.1-pro-preview (most capable) |
| `lite` | gemini-2.5-flash-lite (cheapest) |
| `flash-2` | gemini-2.5-flash |
| `pro-2` | gemini-2.5-pro |

## Effort Levels

Use with `--effort` on any command (maps to Gemini thinking budget):

| Level | Budget |
|-------|--------|
| `low` | Light reasoning |
| `medium` | Standard |
| `high` | Deep reasoning |
| `xhigh`, `max` | Maximum |
| `none` | No thinking |
| `<number>` | Token count |

## Review Gate

```
/gemini:setup --enable-review-gate     # Enable
/gemini:setup --disable-review-gate    # Disable
/gemini:setup --gate-config model=pro  # Configure
```

## Runtime

All commands route through `scripts/gemini-companion.mjs`. This single entry point handles:
- Model alias resolution
- Effort levels (reserved for future Gemini CLI support)
- Background job tracking (`.gemini-tasks/state.json`)
- Structured JSON output parsing
- Session lifecycle (SessionStart/SessionEnd hooks)

The stop review gate (`hooks/hooks.json`) uses Node.js and skips turns that didn't make code edits.

## Common Patterns

```
/gemini:review                          # Auto-detect scope
/gemini:review --model pro --effort high --base main
/gemini:analyze                         # Interactive menu
/gemini:consult --model flash --effort low quick fix
/gemini:challenge question the caching design
```

All commands work with zero arguments — they auto-detect context and present interactive menus.
