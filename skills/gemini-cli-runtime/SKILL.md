---
name: gemini-cli-runtime
description: Internal contract for calling gemini-companion runtime from Claude Code
user-invocable: false
---

# Gemini CLI Runtime Contract

This skill defines how to call the `gemini-companion.mjs` runtime from Claude Code agents and commands.

## Primary entry point

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" task "<prompt and flags>"
```

## Rescue agent rules

- One `Bash` call to `gemini-companion.mjs task`. Return stdout verbatim — no commentary.
- Do NOT call `review`, `challenge`, `status`, `result`, or `cancel` from consult.
- May use `gemini-prompting` skill ONLY to shape the prompt before forwarding.

## Flag handling

| Flag | Behavior |
|------|----------|
| `--model <alias>` | Passed through to companion; alias resolution happens inside |
| `--effort <level>` | Reserved for future use (not yet supported by Gemini CLI) |
| `--resume-last` | Resumes latest Gemini session thread |
| `--write` | Enables write mode (`--yolo` inside companion) |
| `--background` / `--wait` | Strip these — consult always runs foreground |
| `--resume` / `--fresh` | Strip these routing flags; use `--resume-last` instead |

## Default behavior

- Default `--write` unless user explicitly asks for read-only.
- Do not add `--background` — consult runs synchronously.
- Do not interpret or summarize Gemini output — return it verbatim.
