---
description: Run a Gemini challenge review — maximum skepticism, challenges assumptions. Supports --base, --model, --effort, focus text.
argument-hint: "[--wait|--background] [--base <ref>] [--model <alias>] [--effort <level>] [focus ...]"
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Bash(node:*), Bash(git:*), AskUserQuestion
---

Run a challenge review via Gemini. Defaults to skepticism — assumes bugs exist.

## Steps

1. Parse flags: `--base <ref>`, `--background`, `--wait`, `--model <alias>`, `--effort <level>`
   Remaining positional args are the focus text (e.g. `/gemini:challenge focus on auth`).

2. Check diff size; use `AskUserQuestion` if large (>500 lines):
   "This is a large diff. Run in background? [Y/n]"

3. Run:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" challenge $ARGUMENTS
   ```

4. Return the output verbatim.
