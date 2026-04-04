---
description: Cancel a running Gemini background job. Optionally pass a job ID; defaults to the latest running job.
argument-hint: "[job-id]"
disable-model-invocation: true
allowed-tools: Bash(node:*)
---

!`node "${CLAUDE_PLUGIN_ROOT}/scripts/gemini-companion.mjs" cancel $ARGUMENTS`

Return the cancellation result verbatim.
