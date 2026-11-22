// scripts/lib/tracked-jobs.mjs
import fs from "node:fs";
import { upsertJob, getConfig, ensureStateDir, resolveJobLogFile } from "./state.mjs";

/**
 * Exported into the Claude Code session environment by the SessionStart hook.
 * (Deliberately not GEMINI_SESSION_ID, which other Gemini tooling uses.)
 */
export const SESSION_ID_ENV = "GEMINI_COMPANION_SESSION_ID";
const PROMPT_PREVIEW_CHARS = 200;

export function nowIso() {
  return new Date().toISOString();
}

/** @param {string} workspaceRoot */
export function resolveSessionId(workspaceRoot) {
  return process.env[SESSION_ID_ENV] || getConfig(workspaceRoot).lastSessionId || null;
}

/**
 * @param {string} jobId
 * @param {string} jobClass
 * @param {{ prompt?: string | null, model?: string | null, effort?: string | null, write?: boolean,
 *           sessionId?: string | null, pid?: number | null }} [options]
 */
export function createJobRecord(jobId, jobClass, options = {}) {
  const prompt = options.prompt ?? null;
  return {
    id: jobId,
    class: jobClass,
    status: "running",
    createdAt: nowIso(),
    startedAt: nowIso(),
    sessionId: options.sessionId ?? process.env[SESSION_ID_ENV] ?? null,
    // Filled in with the detached worker's pid once it has been spawned.
    pid: options.pid ?? null,
    // Only a preview: full prompts (which embed whole diffs) live in a
    // per-job file so state.json stays small.
    promptPreview: prompt ? prompt.replace(/\s+/g, " ").trim().slice(0, PROMPT_PREVIEW_CHARS) : null,
    model: options.model ?? null,
    effort: options.effort ?? null,
    write: options.write ?? false,
  };
}

/** @param {string} workspaceRoot @param {string} jobId */
export function createJobLogFile(workspaceRoot, jobId) {
  ensureStateDir(workspaceRoot);
  return resolveJobLogFile(workspaceRoot, jobId);
}

/** @param {string} logFile @param {string} line */
export function appendLogLine(logFile, line) {
  try { fs.appendFileSync(logFile, line + "\n", "utf8"); } catch { /* ignore */ }
}

/** @param {string} workspaceRoot @param {string} jobId @param {string} logFile */
export function createProgressReporter(workspaceRoot, jobId, logFile) {
  return (/** @type {string} */ message) => {
    appendLogLine(logFile, `[${nowIso()}] ${message}`);
    upsertJob(workspaceRoot, { id: jobId, lastMessage: message, updatedAt: nowIso() });
  };
}

/** @param {string} workspaceRoot @param {string} jobId */
export function createJobProgressUpdater(workspaceRoot, jobId) {
  return (/** @type {Record<string, any>} */ updates) => {
    upsertJob(workspaceRoot, { id: jobId, ...updates, updatedAt: nowIso() });
  };
}
