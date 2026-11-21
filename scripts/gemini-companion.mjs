#!/usr/bin/env node
// scripts/gemini-companion.mjs
// Single entry point for all gemini plugin commands.

import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { resolveWorkspaceRoot } from "./lib/workspace.mjs";
import { parseArgs } from "./lib/args.mjs";
import { getConfig, setConfig, updateState, generateJobId, upsertJob, listJobs, readJobFile, writeJobFile, ensureStateDir, resolveJobPromptFile, resolveJobLogFile } from "./lib/state.mjs";
import { ensureGitRepository, resolveReviewTarget, collectReviewContext } from "./lib/git.mjs";
import { getAgyAvailability, getAgyLoginStatus, buildAgyArgs, runAgy, parseStructuredOutput } from "./lib/agy.mjs";
import { loadPromptTemplate, interpolateTemplate } from "./lib/prompts.mjs";
import {
  renderSetupReport, renderStatusReport, renderReviewResult,
  renderNativeReviewResult, renderTaskResult, renderJobStatusReport, renderCancelReport,
} from "./lib/render.mjs";
import { buildStatusSnapshot, buildSingleJobSnapshot, resolveCancelableJob, resolveResultJob, readJobProgressPreview } from "./lib/job-control.mjs";
import { createJobRecord, createJobLogFile, createProgressReporter, createJobProgressUpdater, resolveSessionId, nowIso } from "./lib/tracked-jobs.mjs";
import { terminateProcessTree } from "./lib/process.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(__dirname, "..");

const cwd = process.cwd();
const workspaceRoot = resolveWorkspaceRoot(cwd);

const [,, subcommand, ...rawArgs] = process.argv;

/** @param {string} str */
function out(str) { process.stdout.write(str + "\n"); }
/** @param {string} str */
function err(str) { process.stderr.write(str + "\n"); }

const REVIEW_KINDS = new Set(["review", "challenge"]);
const RESULT_WAIT_MS = 540000;
const DEFAULT_TIMEOUT_MS = 600000;

/** Per-run timeout; override with GEMINI_COMPANION_TIMEOUT_MS for very large codebases. */
function runTimeout() {
  const override = Number(process.env.GEMINI_COMPANION_TIMEOUT_MS);
  return Number.isFinite(override) && override > 0 ? override : DEFAULT_TIMEOUT_MS;
}

/**
 * Report a failure and exit non-zero. Failures are never printed as if they
 * were Gemini output, so callers cannot mistake them for a result.
 * @param {string} message
 * @param {boolean} [json]
 * @returns {never}
 */
function fail(message, json) {
  if (json) out(JSON.stringify({ error: message }));
  else err(`Error: ${message}`);
  process.exit(1);
}

/**
 * Run agy in the foreground and return its result, exiting on failure.
 * @param {string} prompt
 * @param {Parameters<typeof buildAgyArgs>[0]} agyOptions
 * @param {boolean} [json]
 */
function runForeground(prompt, agyOptions, json, errorSuffix = "") {
  const result = runAgy(buildAgyArgsOrFail(agyOptions, json), { cwd, prompt, timeout: runTimeout() });
  if (!result.ok) fail(`${result.error ?? "agy run failed"}${errorSuffix}`, json);
  return result;
}

/**
 * buildAgyArgs rejects malformed --model / --effort / conversation values;
 * report that as a normal usage error instead of a stack trace.
 * @param {Parameters<typeof buildAgyArgs>[0]} agyOptions
 * @param {boolean} [json]
 */
function buildAgyArgsOrFail(agyOptions, json) {
  try { return buildAgyArgs(agyOptions); }
  catch (e) { return fail(/** @type {Error} */ (e).message, json); }
}

const NO_TEXT = "(agy returned no text)";

/**
 * A review with no text is a failure, not a clean review. agy prints
 * soft-denied tool notices on stderr, so show its tail.
 * @param {{ stderr: string }} result
 */
function emptyReviewError(result) {
  const tail = result.stderr.split(/\r?\n/).filter(Boolean).slice(-5).join("\n");
  return `agy returned an empty review${tail ? `: ${tail}` : " (stderr was empty)"}`;
}
const NO_RESUMABLE_TASK = "No previous task conversation to resume — run without --resume-last to start one.";
const RESUME_FAILED_HINT = " If that conversation no longer exists, run the task without --resume-last to start a new one.";

/**
 * The recorded id of the most recent `task` conversation, or null. Resume only
 * ever uses a recorded id — never agy's "most recent conversation", which may
 * belong to a review, analysis or stop-gate run.
 * @returns {string | null}
 */
function recordedTaskConversationId() {
  const entry = getConfig(workspaceRoot).lastTaskConversation;
  return entry && typeof entry.id === "string" && entry.id ? entry.id : null;
}

/**
 * Remember the conversation a `task` run produced, unless a task that started
 * later has already recorded its own (a slow background job must not hijack
 * the pointer from a newer run).
 * @param {string | null | undefined} conversationId
 * @param {string} startedAt ISO time the producing run began
 */
function rememberTaskConversation(conversationId, startedAt) {
  if (!conversationId) return;
  updateState(workspaceRoot, (state) => {
    const current = state.config.lastTaskConversation;
    if (current && typeof current.startedAt === "string" && current.startedAt > startedAt) return;
    state.config.lastTaskConversation = { id: conversationId, startedAt };
  });
}

/**
 * Spawn a detached worker for a long-running job. The prompt is handed over
 * in a file (not argv) so large diffs cannot exceed the OS argument limit.
 * @param {string} kind
 * @param {string} prompt
 * @param {{ model?: string, effort?: string, dirs?: string, write?: boolean, resumeLast?: boolean, json?: boolean }} options
 */
function startBackgroundJob(kind, prompt, options) {
  // Validate user-supplied flag values now, not inside the detached worker
  // where a bad value would only surface later as a failed job.
  buildAgyArgsOrFail({ model: options.model, effort: options.effort, dirs: options.dirs, write: options.write }, options.json);
  const jobId = generateJobId(kind);
  ensureStateDir(workspaceRoot);
  fs.writeFileSync(resolveJobPromptFile(workspaceRoot, jobId), prompt, "utf8");

  const record = createJobRecord(jobId, kind, {
    prompt, model: options.model, effort: options.effort, write: options.write,
    sessionId: resolveSessionId(workspaceRoot),
  });
  upsertJob(workspaceRoot, record);

  const workerArgs = [path.join(PLUGIN_ROOT, "scripts", "gemini-companion.mjs"), "task-worker", "--job-id", jobId];
  if (options.model) workerArgs.push("--model", options.model);
  if (options.effort) workerArgs.push("--effort", options.effort);
  if (options.dirs) workerArgs.push("--dirs", options.dirs);
  if (options.write) workerArgs.push("--write");
  if (options.resumeLast) workerArgs.push("--resume-last");

  const worker = spawn(process.execPath, workerArgs, { cwd, detached: true, stdio: "ignore", windowsHide: true });
  worker.on("error", () => { /* surfaced via orphan reconciliation in status */ });
  // Record the worker's pid (not ours — this process exits immediately) so
  // cancel and the SessionEnd hook terminate the right process group.
  upsertJob(workspaceRoot, { id: jobId, pid: worker.pid ?? null });
  worker.unref();

  const label = kind.charAt(0).toUpperCase() + kind.slice(1);
  if (options.json) out(JSON.stringify({ jobId, status: "running" }));
  else out(`${label} started in background. Job ID: **${jobId}**\nCheck status: \`/gemini:status\` — fetch output: \`/gemini:result ${jobId}\``);
}

/**
 * @param {string} kind
 * @param {string} response
 * @param {{ jobId?: string, model?: string | null }} [meta]
 */
function renderJobOutput(kind, response, meta = {}) {
  if (!REVIEW_KINDS.has(kind)) return renderTaskResult({ output: response }, meta);
  const parsed = parseStructuredOutput(response);
  return parsed.parsed && parsed.parsed.verdict
    ? renderReviewResult(parsed.parsed, meta)
    : renderNativeReviewResult(response, meta);
}

// --- setup ---
/** @param {string[]} args */
async function cmdSetup(args) {
  const { options } = parseArgs(args, {
    booleanOptions: ["enable-review-gate", "disable-review-gate", "json"],
  });

  if (options["enable-review-gate"]) {
    setConfig(workspaceRoot, "stopReviewGate", true);
  }
  if (options["disable-review-gate"]) {
    setConfig(workspaceRoot, "stopReviewGate", false);
  }

  const avail = getAgyAvailability(cwd);
  const loginStatus = avail.available
    ? getAgyLoginStatus(cwd)
    : { available: false, loggedIn: false, detail: null };
  const config = getConfig(workspaceRoot);

  const report = {
    agyAvailable: avail.available,
    agyVersion: avail.version ?? null,
    loggedIn: loginStatus.loggedIn,
    detail: loginStatus.detail ?? null,
    reviewGateEnabled: config.stopReviewGate ?? false,
  };

  if (options.json) {
    out(JSON.stringify(report));
  } else {
    out(renderSetupReport(report));
  }
}

// --- review / challenge ---
/** @param {string[]} args @param {string} promptName */
async function runReview(args, promptName) {
  const { options, positionals } = parseArgs(args, {
    booleanOptions: ["wait", "background", "json"],
    valueOptions: ["base", "model", "effort"],
  });

  ensureGitRepository(cwd);
  const target = resolveReviewTarget(cwd, { base: options.base });
  const context = collectReviewContext(cwd, target);

  if (context.isEmpty) {
    const message = `Nothing to review: no changes found for ${target.label}.`;
    if (options.json) out(JSON.stringify({ verdict: null, summary: message, findings: [], skipped: true }));
    else out(message);
    return;
  }

  const template = loadPromptTemplate(PLUGIN_ROOT, promptName);
  const focusText = positionals.join(" ").trim();
  const prompt = interpolateTemplate(template, {
    REVIEW_INPUT: context.content,
    TARGET_LABEL: target.label,
    USER_FOCUS: focusText || "General code review — all areas",
  });

  if (options.background) {
    startBackgroundJob(promptName, prompt, { model: options.model, effort: options.effort, json: options.json });
    return;
  }

  const result = runForeground(prompt, { model: options.model, effort: options.effort }, options.json);
  if (result.empty) fail(emptyReviewError(result), options.json);
  const rawOutput = result.response;
  if (options.json) {
    const parsed = parseStructuredOutput(rawOutput);
    out(JSON.stringify({ verdict: parsed.parsed?.verdict ?? null, summary: parsed.parsed?.summary ?? null, findings: parsed.parsed?.findings ?? [], rawOutput }));
  } else {
    out(renderJobOutput(promptName, rawOutput, { model: options.model }));
  }
}

/** @param {string[]} args */
async function cmdReview(args) { return runReview(args, "review"); }
/** @param {string[]} args */
async function cmdChallenge(args) { return runReview(args, "challenge"); }

// --- analyze ---
/** @param {string[]} args */
async function cmdAnalyze(args) {
  const { options, positionals } = parseArgs(args, {
    booleanOptions: ["background", "wait", "json"],
    valueOptions: ["model", "effort", "dirs", "files"],
  });

  const analysisType = positionals.join(" ").trim() || "Provide a comprehensive analysis of this codebase: architecture, patterns, quality, and areas for improvement.";
  const projectContext = [`Working directory: ${cwd}`];
  if (options.dirs) projectContext.push(`Additional directories in scope: ${options.dirs}`);
  if (options.files) projectContext.push(`Restrict the analysis to files matching: ${options.files}`);
  const template = loadPromptTemplate(PLUGIN_ROOT, "analyze");
  const prompt = interpolateTemplate(template, {
    ANALYSIS_TYPE: analysisType,
    PROJECT_CONTEXT: projectContext.join("\n"),
  });

  if (options.background) {
    startBackgroundJob("analyze", prompt, { model: options.model, effort: options.effort, dirs: options.dirs, json: options.json });
    return;
  }

  const rawOutput = runForeground(prompt, { model: options.model, effort: options.effort, dirs: options.dirs }, options.json).response;
  if (options.json) { out(JSON.stringify({ output: rawOutput })); }
  else { out(rawOutput || NO_TEXT); }
}

// --- task ---
/** @param {string[]} args */
async function cmdTask(args) {
  const { options, positionals } = parseArgs(args, {
    booleanOptions: ["background", "wait", "write", "resume-last", "json"],
    valueOptions: ["model", "effort", "prompt-file"],
  });

  let prompt = positionals.join(" ").trim();
  if (options["prompt-file"]) {
    try { prompt = [fs.readFileSync(path.resolve(cwd, options["prompt-file"]), "utf8").trim(), prompt].filter(Boolean).join("\n\n"); }
    catch (e) { fail(`Could not read --prompt-file: ${/** @type {Error} */ (e).message}`, options.json); }
  }
  if (!prompt) fail("task requires a prompt", options.json);

  const resume = Boolean(options["resume-last"]);
  const conversationId = resume ? recordedTaskConversationId() : null;
  if (resume && !conversationId) fail(NO_RESUMABLE_TASK, options.json);

  if (options.background) {
    startBackgroundJob("task", prompt, {
      model: options.model, effort: options.effort, write: options["write"],
      resumeLast: options["resume-last"], json: options.json,
    });
    return;
  }

  const startedAt = nowIso();
  const result = runForeground(prompt, {
    model: options.model,
    effort: options.effort,
    write: options["write"],
    ...(conversationId ? { conversationId } : {}),
  }, options.json, resume ? RESUME_FAILED_HINT : "");
  rememberTaskConversation(result.conversationId, startedAt);
  const rawOutput = result.response;

  if (options.json) { out(JSON.stringify({ output: rawOutput })); }
  else { out(rawOutput || NO_TEXT); }
}

// --- task-worker (background child process) ---
/** @param {string[]} args */
async function cmdTaskWorker(args) {
  const { options } = parseArgs(args, {
    booleanOptions: ["write", "resume-last"],
    valueOptions: ["job-id", "model", "effort", "dirs"],
  });

  const jobId = options["job-id"];
  if (!jobId) { err("task-worker: --job-id required"); process.exit(1); }

  const updateJob = createJobProgressUpdater(workspaceRoot, jobId);
  const logFile = createJobLogFile(workspaceRoot, jobId);
  const report = createProgressReporter(workspaceRoot, jobId, logFile);
  const isCancelled = () => listJobs(workspaceRoot).find((j) => j.id === jobId)?.status === "cancelled";

  try {
    updateJob({ pid: process.pid });
    report("Worker started — waiting for agy");
    const prompt = fs.readFileSync(resolveJobPromptFile(workspaceRoot, jobId), "utf8");
    const record = listJobs(workspaceRoot).find((j) => j.id === jobId);
    const resume = Boolean(options["resume-last"]);
    const conversationId = resume ? recordedTaskConversationId() : null;
    if (resume && !conversationId) throw new Error(NO_RESUMABLE_TASK);
    const agyArgs = buildAgyArgs({
      model: options.model || null,
      effort: options.effort || null,
      dirs: options.dirs,
      write: options["write"],
      ...(conversationId ? { conversationId } : {}),
    });

    const result = runAgy(agyArgs, { cwd, prompt, timeout: runTimeout() });
    if (isCancelled()) return;

    const error = !result.ok ? `${result.error ?? "agy run failed"}${resume ? RESUME_FAILED_HINT : ""}`
      : REVIEW_KINDS.has(record?.class) && result.empty ? emptyReviewError(result) : null;
    if (error) {
      writeJobFile(workspaceRoot, jobId, { id: jobId, status: "error", error, output: result.response || null });
      updateJob({ status: "error", completedAt: nowIso(), error });
      report(`Failed: ${error}`);
      return;
    }
    // Output lives in a per-job file; state.json only tracks metadata.
    writeJobFile(workspaceRoot, jobId, { id: jobId, status: "done", output: result.response ?? "", conversationId: result.conversationId });
    if (record?.class === "task") rememberTaskConversation(result.conversationId, record.startedAt ?? nowIso());
    updateJob({ status: "done", completedAt: nowIso() });
    report("Completed");
  } catch (error) {
    if (isCancelled()) return;
    updateJob({ status: "error", completedAt: nowIso(), error: /** @type {Error} */ (error).message });
  }
}

// --- task-resume-candidate ---
/** @param {string[]} args */
async function cmdTaskResumeCandidate(args) {
  const { options } = parseArgs(args, { booleanOptions: ["json"] });
  const conversationId = recordedTaskConversationId();
  const resumable = conversationId !== null;
  const latest = listJobs(workspaceRoot)
    .filter((j) => j.class === "task" && j.status === "done")
    .sort((x, y) => (y.completedAt ?? "").localeCompare(x.completedAt ?? ""))[0] ?? null;

  if (options.json) {
    out(JSON.stringify({ resumable, jobId: resumable ? latest?.id ?? null : null, conversationId }));
  } else {
    out(resumable ? `Resumable task conversation: ${conversationId}` : "No resumable task found.");
  }
}

// --- status ---
/** @param {string[]} args */
async function cmdStatus(args) {
  const { options, positionals } = parseArgs(args, {
    booleanOptions: ["all", "wait", "json"],
  });

  const jobId = positionals[0] ?? null;
  if (jobId) {
    const snapshot = buildSingleJobSnapshot(workspaceRoot, jobId);
    if (!snapshot.job) fail(snapshot.error ?? `No job found with ID: ${jobId}`, options.json);
    const job = { ...snapshot.job, progress: readJobProgressPreview(resolveJobLogFile(workspaceRoot, snapshot.job.id)) };
    if (options.json) out(JSON.stringify({ job }));
    else out(renderJobStatusReport(job));
    return;
  }

  const snapshot = buildStatusSnapshot(workspaceRoot, { all: options.all });
  if (options.json) out(JSON.stringify(snapshot));
  else out(renderStatusReport(snapshot));
}

// --- result ---
/** @param {string[]} args */
async function cmdResult(args) {
  const { options, positionals } = parseArgs(args, { booleanOptions: ["json", "wait"] });
  const jobId = positionals[0] ?? null;
  let { job, error } = resolveResultJob(workspaceRoot, jobId);
  // --wait blocks until the job finishes. Capped below the Bash tool's 10-minute
  // limit; a job still running then is reported as running, so callers can wait again.
  const waitUntil = Date.now() + RESULT_WAIT_MS;
  while (options.wait && job?.status === "running" && Date.now() < waitUntil) {
    await sleep(1000);
    ({ job, error } = resolveResultJob(workspaceRoot, jobId));
  }

  if (error || !job) fail(error ?? "No job found", options.json);

  const stored = readJobFile(workspaceRoot, job.id);
  // `job.output` covers jobs recorded by plugin versions before 1.1.0.
  const output = stored?.output ?? job.output ?? null;

  if (options.json) {
    out(JSON.stringify({ jobId: job.id, class: job.class ?? null, status: job.status, output, error: job.error ?? null }));
    return;
  }
  if (job.status === "running") {
    out(`Job **${job.id}** is still running. Check progress with \`/gemini:status ${job.id}\`.`);
  } else if (job.status === "cancelled") {
    out(`Job **${job.id}** was cancelled and has no result.`);
  } else if (job.status === "error") {
    out(`## Job ${job.id} failed\n**Error:** ${job.error ?? "unknown error"}${output ? `\n\n${renderJobOutput(job.class, output)}` : ""}`);
  } else {
    out(renderJobOutput(job.class, output || NO_TEXT, { jobId: job.id, model: job.model }));
  }
}

// --- cancel ---
/** @param {string[]} args */
async function cmdCancel(args) {
  const { options, positionals } = parseArgs(args, { booleanOptions: ["json"] });
  const jobId = positionals[0] ?? null;
  const { job, error } = resolveCancelableJob(workspaceRoot, jobId);

  if (error || !job) fail(error ?? "No job found", options.json);

  // Mark first so the worker does not overwrite the status on its way out.
  upsertJob(workspaceRoot, { id: job.id, status: "cancelled", completedAt: nowIso() });
  terminateProcessTree(job.pid);

  if (options.json) { out(JSON.stringify({ jobId: job.id, status: "cancelled" })); }
  else { out(renderCancelReport(job)); }
}

// --- router ---
const commands = {
  setup: cmdSetup,
  review: cmdReview,
  challenge: cmdChallenge,
  analyze: cmdAnalyze,
  task: cmdTask,
  "task-worker": cmdTaskWorker,
  "task-resume-candidate": cmdTaskResumeCandidate,
  status: cmdStatus,
  result: cmdResult,
  cancel: cmdCancel,
};

const handler = /** @type {Record<string, (args: string[]) => Promise<void>>} */ (commands)[subcommand];
if (!handler) {
  err(`Unknown subcommand: ${subcommand ?? "(none)"}`);
  err(`Available: ${Object.keys(commands).join(", ")}`);
  process.exit(1);
}

try {
  await handler(rawArgs);
} catch (e) {
  err(`Error: ${/** @type {Error} */ (e).message}`);
  process.exit(1);
}
