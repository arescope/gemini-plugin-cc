---
description: Run a Gemini code review on your current changes. Supports --base, --model, --effort, --background, --wait.
argument-hint: "[--wait|--background] [--base <ref>] [--model <alias>] [--effort <level>]"
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Bash(node:*), Bash(git:*), AskUserQuestion
---

Run a Gemini code review via the companion runtime. This command is **read-only**.

## Steps

1. Parse flags from user arguments: `--base <ref>`, `--background`, `--wait`, `--model <alias>`, `--effort <level>`

2. Check diff size to recommend background vs foreground:
   ```bash
   git diff --stat 2>/dev/null; git diff --cached --stat 2>/dev/null; git status --short 2>/dev/null
   ```
   If >500 lines total: use `AskUserQuestion` to ask: "This is a large diff. Run in background? [Y/n]"

3. Run the review:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" review $ARGUMENTS
   ```

4. Return the output verbatim. If the command fails, show its error message and suggest `/gemini:setup`; do not review the changes yourself instead.
