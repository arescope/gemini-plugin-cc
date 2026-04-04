#!/usr/bin/env node
// scripts/session-lifecycle-hook.mjs
// Called by hooks.json for SessionStart and SessionEnd events.

import { readFileSync } from "node:fs";
import { resolveWorkspaceRoot } from "./lib/workspace.mjs";
import { loadState, saveState, upsertJob } from "./lib/state.mjs";
import { terminateProcessTree } from "./lib/process.mjs";

const event = process.argv[2]; // "SessionStart" or "SessionEnd"

function readStdin() {
  try { return readFileSync(0, "utf8"); } catch { return ""; }
}

function parseHookInput(raw) {
  try { return JSON.parse(raw); } catch { return {}; }
}

async function handleSessionStart(input) {
  const sessionId = input.session_id ?? null;
  if (!sessionId) return;
  const cwd = process.cwd();
  const root = resolveWorkspaceRoot(cwd);
  // Store session_id in state config so task workers can reference it
  const state = loadState(root);
  state.config = state.config ?? {};
  state.config.lastSessionId = sessionId;
  saveState(root, state);
}

async function handleSessionEnd(input) {
  const sessionId = input.session_id ?? null;
  if (!sessionId) return;
  const cwd = process.cwd();
  const root = resolveWorkspaceRoot(cwd);
  const state = loadState(root);
  // Kill all running jobs for this session
  const runningJobs = (state.jobs ?? []).filter(
    (j) => j.status === "running" && j.sessionId === sessionId
  );
  for (const job of runningJobs) {
    if (job.pid) {
      terminateProcessTree(job.pid);
    }
    upsertJob(root, { id: job.id, status: "cancelled", completedAt: new Date().toISOString() });
  }
}

const raw = readStdin();
const input = parseHookInput(raw);

if (event === "SessionStart") {
  await handleSessionStart(input);
} else if (event === "SessionEnd") {
  await handleSessionEnd(input);
}

process.exit(0);
