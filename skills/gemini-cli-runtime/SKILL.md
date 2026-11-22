---
name: gemini-cli-runtime
description: Internal contract for calling gemini-companion runtime from Claude Code
user-invocable: false
---

# Gemini Runtime Contract

This skill defines how to call the `gemini-companion.mjs` runtime from Claude Code agents and commands.

## Primary entry point

Consult runs as a tracked background job. Two `Bash` calls, each with `timeout: 600000`:

1. Start the job; stdout is `{"jobId":"...","status":"running"}`:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" task --background --json [flags] "<prompt>"
   ```
2. Wait for it and print the result:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" result <jobId> --wait
   ```
   If it reports the job is still running, run the same command again.


## Rescue agent rules

- Start `task --background --json`, then `result <jobId> --wait`. Return the result verbatim — no commentary.
- Do NOT call `review`, `challenge`, `status`, or `cancel` from consult.
- May use `gemini-prompting` skill ONLY to shape the prompt before forwarding.

## Flag handling

| Flag | Behavior |
|------|----------|
| `--model <alias>` | Passed through to companion; alias resolution happens inside |
| `--effort <level>` | Passed through as agy reasoning effort (`low`, `medium`, `high`, `xhigh`, `max`) |
| `--prompt-file <path>` | Read the prompt from a file — use for long or heavily quoted prompts |
| `--resume-last` | Continues the most recent `task` conversation (by recorded id). Fails if there is none — then run without it. |
| `--write` | Lets Gemini edit files and run commands (`--dangerously-skip-permissions` inside companion). Without it the run is read-only. |
| `--background` / `--wait` | Strip these — the entry-point steps add them |
| `--resume` / `--fresh` | Strip these routing flags; use `--resume-last` instead |

## Default behavior

- Default read-only: add `--write` only when the user explicitly asks Gemini to modify files.
- Do not interpret or summarize Gemini output — return it verbatim.

## Failures

If starting the job fails, the companion exits non-zero and prints `Error: <reason>`. If the job fails, `result --wait` prints `## Job <id> failed` with the error. Report either verbatim; do not retry and do not answer in Gemini's place.
