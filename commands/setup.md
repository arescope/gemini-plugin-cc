---
description: Check Antigravity CLI (agy) installation, authentication status, and manage the review gate. Supports --enable-review-gate, --disable-review-gate.
argument-hint: "[--enable-review-gate|--disable-review-gate]"
allowed-tools: Bash(node:*)
---

Check that the Antigravity CLI (`agy`) is installed and signed in, and manage plugin configuration.

## Steps

1. Run setup check:
   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" setup --json $ARGUMENTS
   ```

2. Parse the JSON result. If `agyAvailable` is false, do not install anything yourself. Tell the user to install the Antigravity CLI and re-run `/gemini:setup`:
   - macOS / Linux: `curl -fsSL https://antigravity.google/cli/install.sh | bash`
   - Windows (PowerShell): `irm https://antigravity.google/cli/install.ps1 | iex`

3. If `loggedIn` is false, show the `detail` message and explain the options: run `agy` once in a terminal to sign in with Google, or set `GEMINI_API_KEY`.

4. Return the setup report.
