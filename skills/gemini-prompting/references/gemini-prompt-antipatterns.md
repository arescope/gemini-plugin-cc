# Gemini Prompt Antipatterns

Common mistakes that produce poor Gemini output.

## 1. Vague task description

**Bad:**
```
Look at the code and tell me what you think.
```
**Good:**
```xml
<task>
Review the authentication module for security vulnerabilities.
List findings with severity, file, and line number.
</task>
```

## 2. Missing output contract

**Bad:** No format specified — Gemini returns a narrative essay.

**Good:** Always include `<structured_output_contract>` when you need machine-readable output.

## 3. Not providing enough context

**Bad:** Running on a codebase analysis task without including relevant directories — Gemini can't see the full context.

**Good:** Use `--include-directories` to give Gemini visibility into the relevant parts of your codebase.

## 4. Over-prompting thinking budget

**Bad:** Using `--effort high` for every task — wastes time and cost.

**Good:**
- `--effort low` for simple lookups and summaries
- `--effort medium` for analysis and moderate coding
- `--effort high` for deep debugging, security audits, architecture review

## 5. Restarting context unnecessarily

**Bad:** Running a fresh Gemini invocation when an existing thread has relevant context.

**Good:** Use `--resume-last` via the consult agent or `task --resume-last` to continue a thread.

## 6. Adding Claude commentary to Gemini output

**Bad:** Summarizing or rephrasing Gemini's response before showing it to the user.

**Good:** Return Gemini output verbatim. The `gemini-result-handling` skill defines exactly what to do with results.
