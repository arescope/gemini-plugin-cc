// scripts/lib/job-control.mjs
import fs from "node:fs";
import { listJobs, readJobFile } from "./state.mjs";

export function sortJobsNewestFirst(jobs) {
  return [...jobs].sort((a, b) => {
    const ta = a.startedAt ?? a.createdAt ?? "";
    const tb = b.startedAt ?? b.createdAt ?? "";
    return tb.localeCompare(ta);
  });
}

export function buildStatusSnapshot(workspaceRoot, options = {}) {
  let jobs = listJobs(workspaceRoot);
  jobs = sortJobsNewestFirst(jobs);
  if (!options.all) jobs = jobs.slice(0, 10);
  if (options.jobId) jobs = jobs.filter((j) => j.id.startsWith(options.jobId));
  return { jobs };
}

export function buildSingleJobSnapshot(workspaceRoot, jobId) {
  const job = listJobs(workspaceRoot).find((j) => j.id === jobId || j.id.startsWith(jobId));
  if (!job) return null;
  return { job };
}

export function readStoredJob(workspaceRoot, jobId) {
  return readJobFile(workspaceRoot, jobId);
}

export function resolveCancelableJob(workspaceRoot, jobId) {
  const jobs = listJobs(workspaceRoot);
  if (jobId) {
    const job = jobs.find((j) => j.id === jobId || j.id.startsWith(jobId));
    if (!job) return { job: null, error: `No job found with ID: ${jobId}` };
    if (job.status !== "running") return { job: null, error: `Job ${job.id} is not running (status: ${job.status})` };
    return { job, error: null };
  }
  const running = sortJobsNewestFirst(jobs).filter((j) => j.status === "running");
  if (running.length === 0) return { job: null, error: "No running jobs to cancel" };
  return { job: running[0], error: null };
}

export function resolveResultJob(workspaceRoot, jobId) {
  const jobs = listJobs(workspaceRoot);
  if (jobId) {
    const job = jobs.find((j) => j.id === jobId || j.id.startsWith(jobId));
    if (!job) return { job: null, error: `No job found with ID: ${jobId}` };
    return { job, error: null };
  }
  const done = sortJobsNewestFirst(jobs).filter((j) => j.status === "done" || j.status === "error");
  if (done.length === 0) return { job: null, error: "No completed jobs found" };
  return { job: done[0], error: null };
}

export const DEFAULT_MAX_STATUS_JOBS = 10;
export const DEFAULT_MAX_PROGRESS_LINES = 20;

export function readJobProgressPreview(logFile, maxLines = DEFAULT_MAX_PROGRESS_LINES) {
  try {
    const content = fs.readFileSync(logFile, "utf8");
    const lines = content.trim().split(/\r?\n/);
    return lines.slice(-maxLines);
  } catch { return []; }
}

export function enrichJob(job, options = {}) {
  return {
    ...job,
    isRunning: job.status === "running",
    isDone: job.status === "done" || job.status === "error",
    isCancelable: job.status === "running",
  };
}
