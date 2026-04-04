# Reusable Prompt Blocks

XML blocks for composing Gemini prompts. Mix and match as needed.

## Core blocks

### `<task>`
```xml
<task>
[What to do. Be specific. State what "done" looks like.]
</task>
```

### `<structured_output_contract>`
```xml
<structured_output_contract>
Return valid JSON matching this schema: [schema here]
Do not include markdown fences or explanation outside the JSON.
</structured_output_contract>
```

### `<default_follow_through_policy>`
```xml
<default_follow_through_policy>
[How to handle ambiguity. What to do when you're not sure.]
</default_follow_through_policy>
```

### `<verification_loop>`
```xml
<verification_loop>
Before finishing: verify you addressed the full task scope.
Re-check your output against the contract above.
</verification_loop>
```

### `<grounding_rules>`
```xml
<grounding_rules>
Ground all findings in the repository context provided.
Do not speculate beyond visible code. File paths and line numbers must be exact.
</grounding_rules>
```

## Extended blocks

### `<action_safety>`
```xml
<action_safety>
Before editing: confirm the target file and scope are correct.
Do not delete or overwrite content outside the stated task scope.
</action_safety>
```

### `<completeness_contract>`
```xml
<completeness_contract>
Complete the full task. Do not truncate output.
If a file is partially modified, finish it — do not leave TODOs.
</completeness_contract>
```

### `<missing_context_gating>`
```xml
<missing_context_gating>
If context is insufficient to complete the task safely, stop and report what's missing.
Do not guess or hallucinate missing information.
</missing_context_gating>
```

### `<research_mode>`
```xml
<research_mode>
Investigate before concluding. Read multiple files before forming a hypothesis.
Follow the call chain. Trace data flow.
</research_mode>
```

### `<dig_deeper_nudge>`
```xml
<dig_deeper_nudge>
If your initial finding seems too shallow, look one level deeper.
Surface-level answers are often incomplete.
</dig_deeper_nudge>
```

### `<progress_updates>`
```xml
<progress_updates>
Report progress every major step. Format: "Step N: [what you did]".
</progress_updates>
```

### `<tool_persistence_rules>`
```xml
<tool_persistence_rules>
If a tool call fails, retry once with adjusted parameters before giving up.
Report the failure explicitly — do not silently skip.
</tool_persistence_rules>
```

### `<citation_rules>`
```xml
<citation_rules>
Cite file paths and line numbers for every claim.
Format: `path/to/file.js:42`
</citation_rules>
```
