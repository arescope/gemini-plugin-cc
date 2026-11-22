// scripts/lib/job-control.mjs
import fs from "node:fs";
import { listJobs, upsertJob } from "./state.mjs";
import { isProcessAlive } from "./process.mjs";

export const DEFAULT_MAX_STATUS_JOBS = 10;
export const DEFAULT_MAX_PROGRESS_LINES = 20;
/** Grace period before a "running" job without a live worker is declared dead. */
const ORPHAN_GRACE_MS = 5000;

/** @param {any[]} jobs */
export function sortJobsNewestFirst(jobs) {
  return [...jobs].sort((a, b) => {
    const ta = a.startedAt ?? a.createdAt ?? "";
    const tb = b.startedAt ?? b.createdAt ?? "";
    return tb.localeCompare(ta);
  });
}

/**
 * Mark "running" jobs whose worker process no longer exists as failed, so a
 * crashed or killed worker does not leave a job running forever.
 * @param {string} workspaceRoot
 */
export function reconcileOrphanedJobs(workspaceRoot) {
  const now = Date.now();
  for (const job of listJobs(workspaceRoot)) {
    if (job.status !== "running") continue;
    const age = now - Date.parse(job.startedAt ?? job.createdAt ?? "");
    if (!(age > ORPHAN_GRACE_MS)) continue;
    if (isProcessAlive(job.pid)) continue;
    upsertJob(workspaceRoot, {
      id: job.id, status: "error", completedAt: new Date().toISOString(),
      error: "Worker process exited without reporting a result",
    });
  }
}

/** Exact ID wins; otherwise a prefix must match exactly one job. @param {any[]} jobs @param {string} jobId */
function findJob(jobs, jobId) {
  const exact = jobs.find((j) => j.id === jobId);
  if (exact) return { job: exact, error: null };
  const matches = jobs.filter((j) => j.id.startsWith(jobId));
  if (matches.length === 1) return { job: matches[0], error: null };
  if (matches.length > 1) return { job: null, error: `Ambiguous job ID "${jobId}" matches: ${matches.map((j) => j.id).join(", ")}` };
  return { job: null, error: `No job found with ID: ${jobId}` };
}

/** @param {string} workspaceRoot @param {{ all?: boolean }} [options] */
export function buildStatusSnapshot(workspaceRoot, options = {}) {
  reconcileOrphanedJobs(workspaceRoot);
  let jobs = sortJobsNewestFirst(listJobs(workspaceRoot));
  if (!options.all) jobs = jobs.slice(0, DEFAULT_MAX_STATUS_JOBS);
  return { jobs };
}

/** @param {string} workspaceRoot @param {string} jobId */
export function buildSingleJobSnapshot(workspaceRoot, jobId) {
  reconcileOrphanedJobs(workspaceRoot);
  return findJob(listJobs(workspaceRoot), jobId);
}

/** @param {string} workspaceRoot @param {string | null} jobId */
export function resolveCancelableJob(workspaceRoot, jobId) {
  reconcileOrphanedJobs(workspaceRoot);
  const jobs = listJobs(workspaceRoot);
  if (jobId) {
    const { job, error } = findJob(jobs, jobId);
    if (!job) return { job: null, error };
    if (job.status !== "running") return { job: null, error: `Job ${job.id} is not running (status: ${job.status})` };
    return { job, error: null };
  }
  const running = sortJobsNewestFirst(jobs).filter((j) => j.status === "running");
  if (running.length === 0) return { job: null, error: "No running jobs to cancel" };
  return { job: running[0], error: null };
}

/** @param {string} workspaceRoot @param {string | null} jobId */
export function resolveResultJob(workspaceRoot, jobId) {
  reconcileOrphanedJobs(workspaceRoot);
  const jobs = listJobs(workspaceRoot);
  if (jobId) {
    return findJob(jobs, jobId);
  }
  const done = sortJobsNewestFirst(jobs).filter((j) => j.status === "done" || j.status === "error");
  if (done.length === 0) return { job: null, error: "No completed jobs found" };
  return { job: done[0], error: null };
}

/** @param {string} logFile @param {number} [maxLines] */
export function readJobProgressPreview(logFile, maxLines = DEFAULT_MAX_PROGRESS_LINES) {
  try {
    return fs.readFileSync(logFile, "utf8").trim().split(/\r?\n/).slice(-maxLines);
  } catch { return []; }
}
