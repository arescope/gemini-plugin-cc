---
description: Consult Gemini on a task. Supports --model, --effort, --write, --resume-last. Use for a second opinion or to delegate work.
argument-hint: "[--background|--wait] [--resume|--fresh] [--model <alias>] [--effort <level>] [task description ...]"
context: fork
allowed-tools: Read, Glob, Grep, Bash(node:*), Bash(git:*), AskUserQuestion
---

Route this request to the `gemini:gemini-consult` subagent.
The final user-visible response must be Gemini's output verbatim.

Before routing, check whether a previous task thread can be resumed:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" task-resume-candidate --json
```

If the result shows `resumable: true` (a conversation id was recorded by an earlier task) and the user did not pass `--fresh`, use `AskUserQuestion` once to ask whether to continue the previous thread or start fresh. Map the answer to `--resume-last` or omit it.

Raw user request:
$ARGUMENTS
