---
name: gemini-prompting
description: Internal guidance for composing Gemini prompts for coding, review, diagnosis, and research tasks
user-invocable: false
---

# Gemini Prompting Guide

How to compose effective prompts for Gemini (run through the Antigravity CLI) in this plugin.

## Core principle

Prompt Gemini like an operator — compact, block-structured with XML tags. One clear task per run. State what "done" looks like.

## Default prompt recipe

Combine these blocks for most tasks:

```xml
<task>What to do. What done looks like.</task>
<structured_output_contract>Format of the expected output.</structured_output_contract>
<default_follow_through_policy>How to handle ambiguity.</default_follow_through_policy>
<verification_loop>Self-check before finishing.</verification_loop>
<grounding_rules>Only use visible context. No speculation.</grounding_rules>
```

## When to add extra blocks

| Situation | Add block |
|-----------|-----------|
| Writing/editing code | `<action_safety>`, `<completeness_contract>` |
| Code review | `<operating_stance>`, `<finding_bar>`, `<calibration_rules>` |
| Research/investigation | `<research_mode>`, `<dig_deeper_nudge>`, `<citation_rules>` |
| Long-running tasks | `<progress_updates>` |
| External tool calls | `<tool_persistence_rules>`, `<missing_context_gating>` |

## Gemini-specific advantages

- Gemini's 1M context window can handle entire codebases — provide broad context.
- Use `--include-directories` to focus on specific parts of the repo when needed.

## Reference files

- `references/prompt-blocks.md` — all reusable XML blocks
- `references/gemini-prompt-recipes.md` — end-to-end templates
- `references/gemini-prompt-antipatterns.md` — failure modes to avoid
