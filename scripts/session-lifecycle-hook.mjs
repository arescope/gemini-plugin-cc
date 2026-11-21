#!/usr/bin/env node
// scripts/session-lifecycle-hook.mjs
// Called by hooks.json for SessionStart and SessionEnd events.

import { readFileSync, appendFileSync } from "node:fs";
import { resolveWorkspaceRoot } from "./lib/workspace.mjs";
import { loadState, updateState, upsertJob } from "./lib/state.mjs";
import { terminateProcessTree } from "./lib/process.mjs";
import { SESSION_ID_ENV } from "./lib/tracked-jobs.mjs";

const event = process.argv[2]; // "SessionStart" or "SessionEnd"

function readStdin() {
  try { return readFileSync(0, "utf8"); } catch { return ""; }
}

/** @param {string} raw */
function parseHookInput(raw) {
  try { return JSON.parse(raw) ?? {}; } catch { return {}; }
}

/** @param {{ session_id?: string, cwd?: string }} input */
function handleSessionStart(input) {
  const sessionId = input.session_id ?? null;
  if (!sessionId) return;

  // Export the session id to every Bash command of this session, so jobs can
  // be attributed to the session that started them (and cleaned up with it).
  const envFile = process.env.CLAUDE_ENV_FILE;
  if (envFile && /^[A-Za-z0-9._-]+$/.test(sessionId)) {
    try { appendFileSync(envFile, `export ${SESSION_ID_ENV}='${sessionId}'\n`, "utf8"); } catch { /* best effort */ }
  }

  // Fallback for environments without CLAUDE_ENV_FILE. Only touch workspaces
  // that already use the plugin — do not create state in every project.
  const root = resolveWorkspaceRoot(input.cwd ?? process.cwd());
  const state = loadState(root);
  if (state.jobs.length === 0 && Object.keys(state.config).length === 0) return;
  updateState(root, (s) => { s.config.lastSessionId = sessionId; });
}

/** @param {{ session_id?: string, cwd?: string }} input */
function handleSessionEnd(input) {
  const sessionId = input.session_id ?? null;
  if (!sessionId) return;
  const root = resolveWorkspaceRoot(input.cwd ?? process.cwd());
  const state = loadState(root);
  // Kill all running jobs started by this session
  const runningJobs = state.jobs.filter((j) => j.status === "running" && j.sessionId === sessionId);
  for (const job of runningJobs) {
    upsertJob(root, { id: job.id, status: "cancelled", completedAt: new Date().toISOString() });
    terminateProcessTree(job.pid);
  }
}

try {
  const input = parseHookInput(readStdin());
  if (event === "SessionStart") handleSessionStart(input);
  else if (event === "SessionEnd") handleSessionEnd(input);
} catch { /* a lifecycle hook must never break the session */ }

process.exit(0);
