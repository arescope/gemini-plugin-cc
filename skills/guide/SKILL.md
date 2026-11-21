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
| `argon`, `pro` | gemini-4-argon — default choice for most engineering work |
| `carbon`, `deep` | gemini-4-carbon — frontier model for deep, complex tasks |
| `hydrogen` | gemini-4-hydrogen — fast and efficient |
| `flash`, `fast`, `lite` | gemini-3.8-flash — fastest and cheapest |

Without `--model`, your `agy` default model is used. Any other value is passed through unchanged — see `agy models` for the full list.

## Effort Levels

Use with `--effort` on any command: `low`, `medium`, `high`, `xhigh`, `max`. Supported levels depend on the model; without the flag the model's default is used.

## Review Gate

```
/gemini:setup --enable-review-gate     # Enable
/gemini:setup --disable-review-gate    # Disable
```

## Runtime

All commands route through `scripts/gemini-companion.mjs`. This single entry point handles:
- Model alias resolution
- Background job tracking (`.gemini-tasks/state.json`)
- Structured JSON output parsing
- Session lifecycle (SessionStart/SessionEnd hooks)

The stop review gate (`hooks/hooks.json`) is off by default; when enabled it only runs if the working tree has uncommitted changes it has not already reviewed.

## Common Patterns

```
/gemini:review                          # Auto-detect scope
/gemini:review --model argon --effort high --base main
/gemini:analyze                         # Interactive menu
/gemini:consult --model flash --effort low quick fix
/gemini:challenge question the caching design
```

All commands work with zero arguments — they auto-detect context and present interactive menus.
