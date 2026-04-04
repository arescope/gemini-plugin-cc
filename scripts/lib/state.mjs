// scripts/lib/state.mjs
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const STATE_DIR = ".gemini-tasks";
const STATE_FILE = "state.json";

export function resolveStateFile(workspaceRoot) { return path.join(workspaceRoot, STATE_DIR, STATE_FILE); }

function ensureStateDir(workspaceRoot) {
  const dir = path.join(workspaceRoot, STATE_DIR);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function loadState(workspaceRoot) {
  try { return JSON.parse(fs.readFileSync(resolveStateFile(workspaceRoot), "utf8")); }
  catch { return { jobs: [], config: {} }; }
}

export function saveState(workspaceRoot, state) {
  ensureStateDir(workspaceRoot);
  fs.writeFileSync(resolveStateFile(workspaceRoot), JSON.stringify(state, null, 2), "utf8");
}

export function getConfig(workspaceRoot) { return loadState(workspaceRoot).config ?? {}; }

export function setConfig(workspaceRoot, key, value) {
  const state = loadState(workspaceRoot);
  state.config = state.config ?? {};
  state.config[key] = value;
  saveState(workspaceRoot, state);
}

export function generateJobId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
}

export function upsertJob(workspaceRoot, job) {
  const state = loadState(workspaceRoot);
  const idx = state.jobs.findIndex((j) => j.id === job.id);
  if (idx >= 0) state.jobs[idx] = { ...state.jobs[idx], ...job };
  else state.jobs.push(job);
  saveState(workspaceRoot, state);
}

export function listJobs(workspaceRoot) { return loadState(workspaceRoot).jobs ?? []; }

export function writeJobFile(workspaceRoot, jobId, data) {
  ensureStateDir(workspaceRoot);
  fs.writeFileSync(path.join(workspaceRoot, STATE_DIR, `${jobId}.json`), JSON.stringify(data, null, 2), "utf8");
}

export function readJobFile(workspaceRoot, jobId) {
  try { return JSON.parse(fs.readFileSync(path.join(workspaceRoot, STATE_DIR, `${jobId}.json`), "utf8")); }
  catch { return null; }
}

export function resolveStateDir(workspaceRoot) {
  return path.join(workspaceRoot, ".gemini-tasks");
}

export function resolveJobsDir(workspaceRoot) {
  return path.join(workspaceRoot, ".gemini-tasks");
}

export function resolveJobLogFile(workspaceRoot, jobId) {
  return path.join(workspaceRoot, ".gemini-tasks", `${jobId}.log`);
}

export function resolveJobFile(workspaceRoot, jobId) {
  return path.join(workspaceRoot, ".gemini-tasks", `${jobId}.json`);
}

export function updateState(workspaceRoot, mutate) {
  const state = loadState(workspaceRoot);
  mutate(state);
  saveState(workspaceRoot, state);
}
