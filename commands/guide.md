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
| `argon`, `pro` | gemini-4-argon — default choice for most engineering work |
| `carbon`, `deep` | gemini-4-carbon — frontier model for deep, complex tasks |
| `hydrogen` | gemini-4-hydrogen — fast and efficient |
| `flash`, `fast`, `lite` | gemini-3.8-flash — fastest and cheapest |

Without `--model`, your `agy` default model is used. Any other value is passed through unchanged — see `agy models` for the full list.

## Effort Levels

Use with `--effort` on any command: `low`, `medium`, `high`, `xhigh`, `max`. Supported levels depend on the model; without the flag the model's default is used.

## Review Gate

```
/gemini:setup --enable-review-gate
/gemini:setup --disable-review-gate
```

## Common Patterns

```
/gemini:review                                    # Auto-detect scope
/gemini:review --model argon --effort high --base main
/gemini:analyze                                   # Interactive menu
/gemini:consult --model flash --effort low quick fix
/gemini:challenge question the caching design
```
