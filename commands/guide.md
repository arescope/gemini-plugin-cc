---
description: "Quick reference for all Gemini plugin commands, model aliases, effort levels, and review gate configuration."
disable-model-invocation: true
---

Print the following reference guide verbatim, then stop.

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
| `/gemini:guide` | This reference |

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
| `<number>` | Exact token count |

## Review Gate

```
/gemini:setup --enable-review-gate
/gemini:setup --disable-review-gate
```

## Common Patterns

```
/gemini:review                                    # Auto-detect scope
/gemini:review --model pro --effort high --base main
/gemini:analyze                                   # Interactive menu
/gemini:consult --model flash --effort low quick fix
/gemini:challenge question the caching design
```
