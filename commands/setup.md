---
description: Check Gemini CLI installation, authentication status, and manage the review gate. Supports --enable-review-gate, --disable-review-gate.
argument-hint: "[--enable-review-gate|--disable-review-gate]"
allowed-tools: Bash(node:*), Bash(npm:*), AskUserQuestion
---

Check Gemini CLI setup and manage plugin configuration.

## Steps

1. Run setup check:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" setup --json $ARGUMENTS
   ```

2. Parse the JSON result. If Gemini CLI is not available, use `AskUserQuestion`:
   "Gemini CLI is not installed. Install it now with `npm install -g @google/gemini-cli`? [Y/n]"
   - Y → run `npm install -g @google/gemini-cli` then re-run setup
   - N → show install instructions

3. Return the setup report verbatim.
