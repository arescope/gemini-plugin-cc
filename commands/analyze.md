---
description: Run a whole-codebase Gemini analysis. Uses Gemini's 1M context window. Supports --model, --effort, --dirs, --files, --background, or free-text analysis type.
argument-hint: "[--background] [--model <alias>] [--effort <level>] [--dirs <dirs>] [--files <glob>] [analysis prompt ...]"
disable-model-invocation: true
allowed-tools: Read, Glob, Grep, Bash(node:*), AskUserQuestion
---

Run a comprehensive Gemini analysis of the codebase. Leverages the full 1M token context window.

## Steps

1. If no arguments provided, use `AskUserQuestion` to ask:
   "What should Gemini analyze? Examples:
   - Architecture review
   - Security audit
   - Performance bottlenecks
   - Tech debt and TODOs
   - Test coverage gaps
   - Or describe your own analysis"

2. Parse flags: `--model <alias>`, `--effort <level>`, `--dirs <comma-separated extra directories>`, `--files <glob to focus on>`, `--background`
   Remaining positional args form the analysis prompt.

3. Run:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" analyze $ARGUMENTS
   ```

4. Return the output verbatim. If the command fails, show its error message and suggest `/gemini:setup`; do not produce your own analysis instead.
