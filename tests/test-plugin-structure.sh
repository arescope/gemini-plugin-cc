#!/usr/bin/env bash
# test-plugin-structure.sh
# Validates the plugin directory structure and file contents.

set -euo pipefail

PLUGIN_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

PASS=0
FAIL=0

assert_file_exists() {
  local desc="$1" path="$2"
  if [ -f "$path" ]; then
    echo "  ✅ $desc"
    PASS=$((PASS + 1))
  else
    echo "  ❌ $desc: file not found at $path"
    FAIL=$((FAIL + 1))
  fi
}

assert_file_gone() {
  local desc="$1" path="$2"
  if [ ! -f "$path" ]; then
    echo "  ✅ $desc (correctly absent)"
    PASS=$((PASS + 1))
  else
    echo "  ❌ $desc: file still exists at $path (should be removed)"
    FAIL=$((FAIL + 1))
  fi
}

assert_dir_exists() {
  local desc="$1" path="$2"
  if [ -d "$path" ]; then
    echo "  ✅ $desc"
    PASS=$((PASS + 1))
  else
    echo "  ❌ $desc: directory not found at $path"
    FAIL=$((FAIL + 1))
  fi
}

assert_json_valid() {
  local desc="$1" path="$2"
  local nodepath
  nodepath=$(cygpath -m "$path" 2>/dev/null || echo "$path")
  if node -e "JSON.parse(require('fs').readFileSync('$nodepath','utf8'))" 2>/dev/null; then
    echo "  ✅ $desc"
    PASS=$((PASS + 1))
  else
    echo "  ❌ $desc: invalid JSON at $path"
    FAIL=$((FAIL + 1))
  fi
}

assert_contains() {
  local desc="$1" path="$2" pattern="$3"
  if grep -q "$pattern" "$path" 2>/dev/null; then
    echo "  ✅ $desc"
    PASS=$((PASS + 1))
  else
    echo "  ❌ $desc: '$pattern' not found in $path"
    FAIL=$((FAIL + 1))
  fi
}

assert_not_contains() {
  local desc="$1" path="$2" pattern="$3"
  if ! grep -q "$pattern" "$path" 2>/dev/null; then
    echo "  ✅ $desc"
    PASS=$((PASS + 1))
  else
    echo "  ❌ $desc: '$pattern' was found in $path (should be absent)"
    FAIL=$((FAIL + 1))
  fi
}

echo "=== Plugin Structure Tests ==="

# Required directories
assert_dir_exists ".claude-plugin/ directory" "$PLUGIN_ROOT/.claude-plugin"
assert_dir_exists "commands/ directory" "$PLUGIN_ROOT/commands"
assert_dir_exists "agents/ directory" "$PLUGIN_ROOT/agents"
assert_dir_exists "hooks/ directory" "$PLUGIN_ROOT/hooks"
assert_dir_exists "scripts/ directory" "$PLUGIN_ROOT/scripts"
assert_dir_exists "scripts/lib/ directory" "$PLUGIN_ROOT/scripts/lib"
assert_dir_exists "prompts/ directory" "$PLUGIN_ROOT/prompts"
assert_dir_exists "schemas/ directory" "$PLUGIN_ROOT/schemas"
assert_dir_exists "skills/ directory" "$PLUGIN_ROOT/skills"
assert_dir_exists "tests/ directory" "$PLUGIN_ROOT/tests"

echo ""
echo "=== Plugin Manifest Tests ==="

assert_file_exists "plugin.json" "$PLUGIN_ROOT/.claude-plugin/plugin.json"
assert_json_valid "plugin.json is valid JSON" "$PLUGIN_ROOT/.claude-plugin/plugin.json"
assert_contains "plugin.json has name" "$PLUGIN_ROOT/.claude-plugin/plugin.json" '"name"'

echo ""
echo "=== Command Files Tests ==="

EXPECTED_COMMANDS=("review" "challenge" "analyze" "consult" "status" "result" "cancel" "setup")
DISABLE_MODEL_COMMANDS=("review" "challenge" "analyze" "status" "result" "cancel")
for cmd in "${EXPECTED_COMMANDS[@]}"; do
  assert_file_exists "commands/${cmd}.md" "$PLUGIN_ROOT/commands/${cmd}.md"
  assert_contains "commands/${cmd}.md has argument-hint" "$PLUGIN_ROOT/commands/${cmd}.md" "argument-hint"
done
# All commands except consult should disable model invocation (consult needs model to route to subagent)
for cmd in "${DISABLE_MODEL_COMMANDS[@]}"; do
  assert_contains "commands/${cmd}.md has disable-model-invocation" "$PLUGIN_ROOT/commands/${cmd}.md" "disable-model-invocation"
done
assert_not_contains "consult does NOT have disable-model-invocation" "$PLUGIN_ROOT/commands/consult.md" "disable-model-invocation"
assert_not_contains "setup does NOT have disable-model-invocation" "$PLUGIN_ROOT/commands/setup.md" "disable-model-invocation"

# consult must have context: fork
assert_contains "consult has context: fork" "$PLUGIN_ROOT/commands/consult.md" "context: fork"

echo ""
echo "=== Agent Tests ==="

assert_file_exists "gemini-consult agent" "$PLUGIN_ROOT/agents/gemini-consult.md"
assert_contains "agent has name" "$PLUGIN_ROOT/agents/gemini-consult.md" "name: gemini-consult"
assert_contains "agent has tools: Bash" "$PLUGIN_ROOT/agents/gemini-consult.md" "tools: Bash"
assert_contains "agent references gemini-cli-runtime skill" "$PLUGIN_ROOT/agents/gemini-consult.md" "gemini-cli-runtime"
assert_contains "agent references gemini-prompting skill" "$PLUGIN_ROOT/agents/gemini-consult.md" "gemini-prompting"

echo ""
echo "=== Hook Tests ==="

assert_file_exists "hooks.json" "$PLUGIN_ROOT/hooks/hooks.json"
assert_json_valid "hooks.json is valid JSON" "$PLUGIN_ROOT/hooks/hooks.json"
assert_contains "hooks.json has SessionStart" "$PLUGIN_ROOT/hooks/hooks.json" '"SessionStart"'
assert_contains "hooks.json has SessionEnd" "$PLUGIN_ROOT/hooks/hooks.json" '"SessionEnd"'
assert_contains "hooks.json has Stop" "$PLUGIN_ROOT/hooks/hooks.json" '"Stop"'

echo ""
echo "=== Script Files Tests ==="

assert_file_exists "gemini-companion.mjs" "$PLUGIN_ROOT/scripts/gemini-companion.mjs"
assert_file_exists "session-lifecycle-hook.mjs" "$PLUGIN_ROOT/scripts/session-lifecycle-hook.mjs"
assert_file_exists "stop-review-gate-hook.mjs" "$PLUGIN_ROOT/scripts/stop-review-gate-hook.mjs"

# Old bash scripts must be gone
assert_file_gone "gemini-review-gate.sh removed" "$PLUGIN_ROOT/scripts/gemini-review-gate.sh"
assert_file_gone "gemini-aliases.sh removed" "$PLUGIN_ROOT/scripts/gemini-aliases.sh"

echo ""
echo "=== Lib Module Tests ==="

LIB_MODULES=("args.mjs" "fs.mjs" "gemini.mjs" "git.mjs" "job-control.mjs" "process.mjs" "prompts.mjs" "render.mjs" "state.mjs" "tracked-jobs.mjs" "workspace.mjs" "types.d.ts")
for mod in "${LIB_MODULES[@]}"; do
  assert_file_exists "scripts/lib/${mod}" "$PLUGIN_ROOT/scripts/lib/${mod}"
done

echo ""
echo "=== Prompt Template Tests ==="

PROMPTS=("review.md" "challenge.md" "analyze.md" "stop-review-gate.md")
for p in "${PROMPTS[@]}"; do
  assert_file_exists "prompts/${p}" "$PLUGIN_ROOT/prompts/${p}"
done

echo ""
echo "=== Schema Tests ==="

assert_file_exists "schemas/review-output.schema.json" "$PLUGIN_ROOT/schemas/review-output.schema.json"
assert_json_valid "review-output.schema.json is valid JSON" "$PLUGIN_ROOT/schemas/review-output.schema.json"
assert_contains "schema has verdict field" "$PLUGIN_ROOT/schemas/review-output.schema.json" '"verdict"'
assert_contains "schema has findings field" "$PLUGIN_ROOT/schemas/review-output.schema.json" '"findings"'

echo ""
echo "=== Skills Tests ==="

assert_file_exists "skills/guide/SKILL.md" "$PLUGIN_ROOT/skills/guide/SKILL.md"
assert_file_exists "skills/gemini-prompting/SKILL.md" "$PLUGIN_ROOT/skills/gemini-prompting/SKILL.md"
assert_file_exists "skills/gemini-result-handling/SKILL.md" "$PLUGIN_ROOT/skills/gemini-result-handling/SKILL.md"
assert_file_exists "skills/gemini-cli-runtime/SKILL.md" "$PLUGIN_ROOT/skills/gemini-cli-runtime/SKILL.md"
assert_file_exists "skills/gemini-prompting/references/prompt-blocks.md" "$PLUGIN_ROOT/skills/gemini-prompting/references/prompt-blocks.md"
assert_file_exists "skills/gemini-prompting/references/gemini-prompt-recipes.md" "$PLUGIN_ROOT/skills/gemini-prompting/references/gemini-prompt-recipes.md"
assert_file_exists "skills/gemini-prompting/references/gemini-prompt-antipatterns.md" "$PLUGIN_ROOT/skills/gemini-prompting/references/gemini-prompt-antipatterns.md"

echo ""
echo "=== Node.js Test Files ==="

NODE_TESTS=("args.test.mjs" "gemini.test.mjs" "git.test.mjs" "process.test.mjs" "render.test.mjs" "state.test.mjs" "commands.test.mjs" "helpers.mjs")
for t in "${NODE_TESTS[@]}"; do
  assert_file_exists "tests/${t}" "$PLUGIN_ROOT/tests/${t}"
done

echo ""
echo "=== Metadata Tests ==="

assert_file_exists "README.md" "$PLUGIN_ROOT/README.md"
assert_file_exists "LICENSE" "$PLUGIN_ROOT/LICENSE"
assert_file_exists ".gitignore" "$PLUGIN_ROOT/.gitignore"

echo ""
echo "=== Results ==="
echo "Passed: $PASS"
echo "Failed: $FAIL"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
echo "All tests passed."
