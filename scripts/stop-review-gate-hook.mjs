#!/usr/bin/env node
// scripts/stop-review-gate-hook.mjs
// Claude Code Stop hook — smarter review gate.
// Reads last_assistant_message from stdin, skips if no code edits were made.

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { resolveWorkspaceRoot } from "./lib/workspace.mjs";
import { getConfig } from "./lib/state.mjs";
import { loadPromptTemplate, interpolateTemplate } from "./lib/prompts.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(__dirname, "..");
const COMPANION = path.join(PLUGIN_ROOT, "scripts", "gemini-companion.mjs");

function readStdin() {
  try { return readFileSync(0, "utf8"); } catch { return ""; }
}

function parseHookInput(raw) {
  try { return JSON.parse(raw); } catch { return {}; }
}

function looksLikeCodeEditTurn(message) {
  if (!message) return false;
  // Heuristics: mentions file edits, writes, creates, or code changes
  const editSignals = [
    /\b(wrote|created|updated|modified|edited|added|removed|deleted|changed)\b/i,
    /\b(file|function|class|method|import|export)\b/i,
    /```[\s\S]*?```/,   // code fence
    /^\s{4}/m,           // indented code block
  ];
  return editSignals.some((re) => re.test(message));
}

async function main() {
  const raw = readStdin();
  const input = parseHookInput(raw);

  const cwd = process.cwd();
  const root = resolveWorkspaceRoot(cwd);
  const config = getConfig(root);

  // Check if stop review gate is enabled
  if (!config.stopReviewGate) {
    process.exit(0);
  }

  // Get last assistant message from hook input
  const lastMessage = input.last_assistant_message ?? input.message ?? "";

  // Skip if the turn doesn't look like it made code edits
  if (!looksLikeCodeEditTurn(lastMessage)) {
    process.exit(0);
  }

  // Load and interpolate the gate prompt
  let prompt;
  try {
    const template = loadPromptTemplate(PLUGIN_ROOT, "stop-review-gate");
    const claudeBlock = lastMessage
      ? `<previous_claude_turn>\n${lastMessage}\n</previous_claude_turn>`
      : "<previous_claude_turn>(no content)</previous_claude_turn>";
    prompt = interpolateTemplate(template, { CLAUDE_RESPONSE_BLOCK: claudeBlock });
  } catch {
    // If prompt template missing, skip gate
    process.exit(0);
  }

  // Run companion task with the gate prompt
  const result = spawnSync(
    "node",
    [COMPANION, "task", "--effort", "low", prompt],
    { cwd, encoding: "utf8", timeout: 890000, stdio: ["ignore", "pipe", "pipe"] }
  );

  const output = (result.stdout ?? "").trim();

  // Parse ALLOW/BLOCK from first line
  const firstLine = output.split(/\r?\n/)[0] ?? "";
  if (firstLine.startsWith("BLOCK:")) {
    const reason = firstLine.slice(6).trim();
    // Output JSON decision for Claude Code Stop hook protocol
    process.stdout.write(JSON.stringify({ decision: "block", reason }) + "\n");
    process.exit(0);
  }

  // Default: allow
  process.exit(0);
}

main().catch(() => process.exit(0));
