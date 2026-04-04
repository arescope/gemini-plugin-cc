// scripts/lib/tracked-jobs.mjs
import fs from "node:fs";
import path from "node:path";
import { upsertJob, writeJobFile } from "./state.mjs";

export const SESSION_ID_ENV = "GEMINI_SESSION_ID";

export function nowIso() {
  return new Date().toISOString();
}

export function createJobRecord(jobId, jobClass, options = {}) {
  return {
    id: jobId,
    class: jobClass,
    status: "running",
    createdAt: nowIso(),
    startedAt: nowIso(),
    sessionId: process.env[SESSION_ID_ENV] ?? null,
    pid: process.pid,
    prompt: options.prompt ?? null,
    model: options.model ?? null,
    effort: options.effort ?? null,
    write: options.write ?? false,
  };
}

export function createJobLogFile(workspaceRoot, jobId) {
  const logDir = path.join(workspaceRoot, ".gemini-tasks");
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
  return path.join(logDir, `${jobId}.log`);
}

export function appendLogLine(logFile, line) {
  try { fs.appendFileSync(logFile, line + "\n", "utf8"); } catch { /* ignore */ }
}

export function createProgressReporter(workspaceRoot, jobId, logFile) {
  return (message) => {
    appendLogLine(logFile, `[${nowIso()}] ${message}`);
    upsertJob(workspaceRoot, { id: jobId, lastMessage: message, updatedAt: nowIso() });
  };
}

export function createJobProgressUpdater(workspaceRoot, jobId) {
  return (updates) => {
    upsertJob(workspaceRoot, { id: jobId, ...updates, updatedAt: nowIso() });
  };
}

export function appendLogBlock(logFile, title, body) {
  const header = `\n=== ${title} [${nowIso()}] ===\n`;
  try { fs.appendFileSync(logFile, header + body + "\n", "utf8"); } catch { /* ignore */ }
}

export async function runTrackedJob(workspaceRoot, jobId, jobClass, runFn, options = {}) {
  const record = createJobRecord(jobId, jobClass, options);
  upsertJob(workspaceRoot, record);
  const logFile = createJobLogFile(workspaceRoot, jobId);
  const report = createProgressReporter(workspaceRoot, jobId, logFile);
  const updateJob = createJobProgressUpdater(workspaceRoot, jobId);
  try {
    const result = await runFn({ report, updateJob });
    updateJob({ status: "done", completedAt: nowIso(), result });
    writeJobFile(workspaceRoot, jobId, { ...record, status: "done", result });
    return result;
  } catch (err) {
    updateJob({ status: "error", completedAt: nowIso(), error: err.message });
    writeJobFile(workspaceRoot, jobId, { ...record, status: "error", error: err.message });
    throw err;
  }
}
