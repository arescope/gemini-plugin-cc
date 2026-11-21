#!/usr/bin/env node
// scripts/stop-review-gate-hook.mjs
// Claude Code Stop hook — optional Gemini review gate.
//
// Runs only when enabled via `/gemini:setup --enable-review-gate`, and only
// when the working tree actually changed since the last gate run. It never
// re-fires on a stop that it caused itself (`stop_hook_active`), so a BLOCK
// costs at most one extra Claude turn rather than looping.

import { readFileSync, statSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import path from "node:path";
import { resolveWorkspaceRoot } from "./lib/workspace.mjs";
import { getConfig, setConfig } from "./lib/state.mjs";
import { loadPromptTemplate, interpolateTemplate } from "./lib/prompts.mjs";
import { runCommand } from "./lib/process.mjs";
import { buildAgyArgs, runAgy } from "./lib/agy.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(__dirname, "..");
const DEFAULT_GATE_TIMEOUT_MS = 780000; // leaves margin under the 900s hook timeout in hooks.json
const MAX_MESSAGE_CHARS = 20000;

function readStdin() {
  try { return readFileSync(0, "utf8"); } catch { return ""; }
}

/** @param {string} raw */
function parseHookInput(raw) {
  try { return JSON.parse(raw) ?? {}; } catch { return {}; }
}

/**
 * Fingerprint of the uncommitted changes, or null when there are none (or
 * this is not a git repository).
 * @param {string} cwd
 */
export function workingTreeFingerprint(cwd) {
  const status = runCommand("git", ["status", "--porcelain", "--untracked-files=all"], { cwd });
  if (status.status !== 0 || !status.stdout) return null;
  const hash = crypto.createHash("sha256").update(status.stdout).update("\0");
  hash.update(runCommand("git", ["diff", "HEAD"], { cwd }).stdout);
  // `git diff` ignores untracked files; track them by size and mtime.
  const untracked = runCommand("git", ["ls-files", "--others", "--exclude-standard"], { cwd }).stdout;
  for (const rel of untracked.split(/\r?\n/).filter(Boolean)) {
    try {
      const stat = statSync(path.join(cwd, rel));
      hash.update(`\0${rel}:${stat.size}:${stat.mtimeMs}`);
    } catch { /* vanished */ }
  }
  return hash.digest("hex");
}

/**
 * Find the verdict line. Models occasionally prepend a blank line or wrap
 * the keyword in markdown, so scan rather than trusting line one.
 * @param {string} output
 * @returns {{ decision: "allow" | "block", reason: string } | null}
 */
export function parseGateVerdict(output) {
  for (const line of String(output ?? "").split(/\r?\n/)) {
    const match = line.match(/^[\s>*_`#-]*(ALLOW|BLOCK)\b[\s:*_`]*(.*)$/);
    if (match) return { decision: match[1] === "BLOCK" ? "block" : "allow", reason: match[2].replace(/[*_`]+$/, "").trim() };
  }
  return null;
}

/** Gate timeout in ms; GEMINI_GATE_TIMEOUT_MS overrides when a positive number. */
export function gateTimeoutMs(env = process.env) {
  const value = Number(env.GEMINI_GATE_TIMEOUT_MS);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_GATE_TIMEOUT_MS;
}

/** @param {Record<string, unknown>} payload */
function emit(payload) {
  process.stdout.write(JSON.stringify(payload) + "\n");
}

function main() {
  const input = parseHookInput(readStdin());

  // Claude is already continuing because of a previous Stop-hook block.
  if (input.stop_hook_active) return;

  const cwd = input.cwd ?? process.cwd();
  const root = resolveWorkspaceRoot(cwd);
  const config = getConfig(root);
  if (!config.stopReviewGate) return;

  // No uncommitted changes, or nothing new since the last gate run → skip.
  const fingerprint = workingTreeFingerprint(root);
  if (!fingerprint || fingerprint === config.lastGateFingerprint) return;

  const lastMessage = String(input.last_assistant_message ?? "").slice(0, MAX_MESSAGE_CHARS);
  let prompt;
  try {
    const template = loadPromptTemplate(PLUGIN_ROOT, "stop-review-gate");
    const claudeBlock = lastMessage
      ? `<previous_claude_turn>\n${lastMessage}\n</previous_claude_turn>`
      : "<previous_claude_turn>(no content available — inspect the repository state)</previous_claude_turn>";
    prompt = interpolateTemplate(template, { CLAUDE_RESPONSE_BLOCK: claudeBlock });
  } catch {
    return; // prompt template missing → skip gate
  }

  const timeout = gateTimeoutMs();
  const result = runAgy(buildAgyArgs({}), { cwd, prompt, timeout });

  // The gate must never edit the user's tree unattended.
  if (result.readOnlyViolated) {
    emit({ systemMessage: `WARNING: Gemini review gate was NOT enforced and its read-only guarantee was violated: ${result.error || "the review run attempted to modify files"}. Check \`git status\` for unexpected changes.` });
    return;
  }
  if (!result.ok) {
    if (result.timedOut) {
      // Do not rerun the same slow review on every Stop.
      setConfig(root, "lastGateFingerprint", fingerprint);
      emit({ systemMessage: `Gemini review gate timed out after ${Math.round(timeout / 1000)}s and will not be retried for these changes. Run /gemini:review to review them in the background.` });
      return;
    }
    // Fail open, but say so: a silently broken gate looks like an approval.
    emit({ systemMessage: `Gemini review gate skipped: ${result.error}` });
    return;
  }

  setConfig(root, "lastGateFingerprint", fingerprint);
  if (result.empty) return; // no verdict to act on
  const verdict = parseGateVerdict(result.response);
  if (verdict?.decision === "block") {
    emit({ decision: "block", reason: `Gemini review gate: ${verdict.reason || "blocking issue found"}` });
  }
}

// Only run when executed as the hook, not when imported by tests.
// (realpath: the plugin directory may be reached through a symlink.)
function isEntryPoint() {
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
}
if (isEntryPoint()) {
  try { main(); } catch { /* fail open */ }
  process.exit(0);
}
