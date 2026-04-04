# Gemini Prompt Recipes

End-to-end prompt templates for common tasks.

## 1. Bug investigation

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/gemini-companion.mjs" task --effort high "
<task>
Investigate the following bug: [DESCRIPTION]
Find the root cause. Trace the full execution path.
</task>
<research_mode>Read broadly before concluding. Follow imports and call chains.</research_mode>
<verification_loop>Confirm your root cause by showing the exact code path that triggers it.</verification_loop>
<grounding_rules>Cite exact file paths and line numbers.</grounding_rules>
"
```

## 2. Architecture review

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/gemini-companion.mjs" task --effort medium "
<task>
Review the architecture of [MODULE/FEATURE].
Identify: coupling issues, missing abstractions, scalability concerns.
</task>
<finding_bar>Only report architectural issues that would require meaningful refactoring to fix.</finding_bar>
<grounding_rules>Reference specific files and patterns.</grounding_rules>
"
```

## 3. Security audit

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/gemini-companion.mjs" task --effort high "
<task>
Perform a security audit of [SCOPE].
Focus: injection, auth bypass, data exposure, input validation.
</task>
<operating_stance>Default to suspicion. Assume edge cases exist until proven otherwise.</operating_stance>
<grounding_rules>Every finding must show the specific code path that creates the vulnerability.</grounding_rules>
"
```

## 4. Refactoring

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/gemini-companion.mjs" task --write --effort medium "
<task>
Refactor [SCOPE] to [GOAL].
Preserve all existing behavior. Do not change public APIs.
</task>
<action_safety>Only modify files within scope. Do not touch unrelated code.</action_safety>
<completeness_contract>Finish all refactoring in one pass. No partial edits.</completeness_contract>
<verification_loop>After refactoring, verify tests would still pass conceptually.</verification_loop>
"
```

## 5. Test coverage analysis

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/gemini-companion.mjs" task --effort medium "
<task>
Analyze test coverage for [MODULE].
Identify: untested code paths, missing edge cases, fragile tests.
</task>
<grounding_rules>Reference specific test files and the production code they cover.</grounding_rules>
<verification_loop>Check for both unit gaps and integration gaps.</verification_loop>
"
```
