---
name: gemini-result-handling
description: Internal guidance for presenting Gemini output back to the user
user-invocable: false
---

# Gemini Result Handling

Rules for presenting Gemini output after a review, task, or analysis run.

## Structured output (reviews)

- Preserve the full structure: verdict, summary, findings, next steps.
- Display findings ordered by severity: critical → high → medium → low.
- Include file paths and line numbers exactly as reported — do not paraphrase.
- Show confidence percentages where provided.

## After review findings

**STOP. Do not auto-fix.**

Present the findings. Ask the user which issues to address. Never immediately start editing code after a review returns findings.

## Task output

- Return companion stdout verbatim. No summarizing. No commentary.
- If Gemini made edits (`--write` mode), list the touched files explicitly.

## Failed runs

- Report the failure clearly. Do not substitute Claude's own answer.
- Suggest the user run `/gemini:setup` if the issue is auth or availability.
- Do not retry silently.

## Setup/auth issues

Direct the user to `/gemini:setup` to diagnose and fix configuration issues.
