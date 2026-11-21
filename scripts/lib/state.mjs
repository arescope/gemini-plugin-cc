// scripts/lib/state.mjs
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const STATE_DIR = ".gemini-tasks";
const STATE_FILE = "state.json";
export const MAX_STORED_JOBS = 50;

/** @typedef {{ jobs: any[], config: Record<string, any> }} State */

/** @param {string} workspaceRoot */
export function resolveStateDir(workspaceRoot) { return path.join(workspaceRoot, STATE_DIR); }
/** @param {string} workspaceRoot */
export function resolveStateFile(workspaceRoot) { return path.join(resolveStateDir(workspaceRoot), STATE_FILE); }
/** @param {string} workspaceRoot @param {string} jobId */
export function resolveJobLogFile(workspaceRoot, jobId) { return path.join(resolveStateDir(workspaceRoot), `${jobId}.log`); }
/** @param {string} workspaceRoot @param {string} jobId */
export function resolveJobFile(workspaceRoot, jobId) { return path.join(resolveStateDir(workspaceRoot), `${jobId}.json`); }
/** @param {string} workspaceRoot @param {string} jobId */
export function resolveJobPromptFile(workspaceRoot, jobId) { return path.join(resolveStateDir(workspaceRoot), `${jobId}.prompt`); }

/**
 * Create the state directory. It gets its own `.gitignore` so runtime state
 * never shows up as untracked files in the user's repository (or in the
 * diffs this plugin sends to Gemini).
 * @param {string} workspaceRoot
 */
export function ensureStateDir(workspaceRoot) {
  const dir = resolveStateDir(workspaceRoot);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const ignore = path.join(dir, ".gitignore");
  if (!fs.existsSync(ignore)) {
    try { fs.writeFileSync(ignore, "*\n", "utf8"); } catch { /* best effort */ }
  }
  return dir;
}

/** @param {string} workspaceRoot @returns {State} */
export function loadState(workspaceRoot) {
  try {
    const state = JSON.parse(fs.readFileSync(resolveStateFile(workspaceRoot), "utf8"));
    return { jobs: Array.isArray(state?.jobs) ? state.jobs : [], config: state?.config ?? {} };
  } catch { return { jobs: [], config: {} }; }
}

/** @param {string} workspaceRoot @param {State} state */
export function saveState(workspaceRoot, state) {
  ensureStateDir(workspaceRoot);
  // Write-then-rename so a concurrent reader never sees a half-written file.
  const target = resolveStateFile(workspaceRoot);
  const tmp = `${target}.${process.pid}.${crypto.randomBytes(3).toString("hex")}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
  fs.renameSync(tmp, target);
}

/** @param {string} workspaceRoot @param {(state: State) => void} mutate */
export function updateState(workspaceRoot, mutate) {
  // mkdir is atomic across processes: without this lock, concurrent workers/hooks overwrite each other's updates.
  const lock = path.join(ensureStateDir(workspaceRoot), "state.lock");
  const deadline = Date.now() + 5000;
  for (;;) {
    try { fs.mkdirSync(lock); break; } catch (/** @type {any} */ err) {
      if (err.code !== "EEXIST") throw err;
      // Checked first: a lock that cannot be removed (e.g. a Windows handle on it) must end here, not spin.
      if (Date.now() > deadline) throw new Error(`Timed out waiting for state lock: ${lock}`);
      try { if (Date.now() - fs.statSync(lock).mtimeMs > 1_000) { fs.rmdirSync(lock); continue; } } catch { continue; } // stale (a holder needs ms; 1s means it crashed), or released meanwhile
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 15);
    }
  }
  try {
    const state = loadState(workspaceRoot);
    mutate(state);
    saveState(workspaceRoot, state);
  } finally {
    try { fs.rmdirSync(lock); } catch { /* already broken as stale */ }
  }
}

/** @param {string} workspaceRoot */
export function getConfig(workspaceRoot) { return loadState(workspaceRoot).config ?? {}; }

/** @param {string} workspaceRoot @param {string} key @param {unknown} value */
export function setConfig(workspaceRoot, key, value) {
  updateState(workspaceRoot, (state) => { state.config[key] = value; });
}

/** @param {string} prefix */
export function generateJobId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`;
}

/** @param {string} workspaceRoot @param {string} jobId */
export function removeJobArtifacts(workspaceRoot, jobId) {
  for (const file of [resolveJobFile(workspaceRoot, jobId), resolveJobLogFile(workspaceRoot, jobId), resolveJobPromptFile(workspaceRoot, jobId)]) {
    try { fs.unlinkSync(file); } catch { /* not there */ }
  }
}

/**
 * Insert or merge a job, keeping only the newest MAX_STORED_JOBS finished
 * jobs (running jobs are never pruned).
 * @param {string} workspaceRoot
 * @param {{ id: string } & Record<string, any>} job
 */
export function upsertJob(workspaceRoot, job) {
  /** @type {string[]} */
  const pruned = [];
  updateState(workspaceRoot, (state) => {
    const idx = state.jobs.findIndex((j) => j.id === job.id);
    if (idx >= 0) state.jobs[idx] = { ...state.jobs[idx], ...job };
    else state.jobs.push(job);
    while (state.jobs.length > MAX_STORED_JOBS) {
      const victim = state.jobs.findIndex((j) => j.status !== "running" && j.id !== job.id);
      if (victim === -1) break;
      pruned.push(state.jobs[victim].id);
      state.jobs.splice(victim, 1);
    }
  });
  for (const id of pruned) removeJobArtifacts(workspaceRoot, id);
}

/** @param {string} workspaceRoot */
export function listJobs(workspaceRoot) { return loadState(workspaceRoot).jobs ?? []; }

/** @param {string} workspaceRoot @param {string} jobId @param {unknown} data */
export function writeJobFile(workspaceRoot, jobId, data) {
  ensureStateDir(workspaceRoot);
  fs.writeFileSync(resolveJobFile(workspaceRoot, jobId), JSON.stringify(data, null, 2), "utf8");
}

/** @param {string} workspaceRoot @param {string} jobId */
export function readJobFile(workspaceRoot, jobId) {
  try { return JSON.parse(fs.readFileSync(resolveJobFile(workspaceRoot, jobId), "utf8")); }
  catch { return null; }
}
