#!/usr/bin/env node
// scripts/gemini-companion.mjs
// Single entry point for all gemini plugin commands.

import { fileURLToPath } from "node:url";
import path from "node:path";
import { spawn } from "node:child_process";
import { resolveWorkspaceRoot } from "./lib/workspace.mjs";
import { parseArgs } from "./lib/args.mjs";
import { getConfig, setConfig, generateJobId, upsertJob, listJobs, readJobFile } from "./lib/state.mjs";
import { ensureGitRepository, resolveReviewTarget, collectReviewContext } from "./lib/git.mjs";
import { getGeminiAvailability, getGeminiLoginStatus, buildGeminiArgs, runGemini, parseStructuredOutput } from "./lib/gemini.mjs";
import { loadPromptTemplate, interpolateTemplate } from "./lib/prompts.mjs";
import {
  renderSetupReport, renderStatusReport, renderReviewResult,
  renderNativeReviewResult, renderTaskResult, renderJobStatusReport, renderCancelReport,
} from "./lib/render.mjs";
import { buildStatusSnapshot, buildSingleJobSnapshot, resolveCancelableJob, resolveResultJob } from "./lib/job-control.mjs";
import { createJobRecord, createJobLogFile, createProgressReporter, createJobProgressUpdater, nowIso } from "./lib/tracked-jobs.mjs";
import { terminateProcessTree } from "./lib/process.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(__dirname, "..");

const cwd = process.cwd();
const workspaceRoot = resolveWorkspaceRoot(cwd);

const [,, subcommand, ...rawArgs] = process.argv;

function out(str) { process.stdout.write(str + "\n"); }
function err(str) { process.stderr.write(str + "\n"); }

// --- setup ---
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

  const avail = getGeminiAvailability(cwd);
  const loginStatus = avail.available ? getGeminiLoginStatus(cwd) : { available: false, loggedIn: false };
  const config = getConfig(workspaceRoot);

  const report = {
    geminiAvailable: avail.available,
    geminiVersion: avail.version ?? null,
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

// --- review (foreground) ---
async function runReview(args, promptName) {
  const { options, positionals } = parseArgs(args, {
    booleanOptions: ["wait", "background", "json"],
    valueOptions: ["base", "model", "effort"],
  });

  ensureGitRepository(cwd);
  const target = resolveReviewTarget(cwd, { base: options.base });
  const context = collectReviewContext(cwd, target);

  const template = loadPromptTemplate(PLUGIN_ROOT, promptName);
  const focusText = positionals.join(" ").trim();
  const prompt = interpolateTemplate(template, {
    REVIEW_INPUT: context.content,
    TARGET_LABEL: target.label,
    USER_FOCUS: focusText || "General code review — all areas",
  });

  if (options.background) {
    // Spawn background task-worker
    const jobId = generateJobId(promptName);
    const record = createJobRecord(jobId, promptName, { prompt, model: options.model, effort: options.effort });
    upsertJob(workspaceRoot, record);

    const worker = spawn(
      "node",
      [path.join(PLUGIN_ROOT, "scripts", "gemini-companion.mjs"), "task-worker", "--job-id", jobId,
       "--prompt", prompt, "--model", options.model ?? "", "--effort", options.effort ?? ""],
      { cwd, detached: true, stdio: "ignore" }
    );
    worker.unref();

    const msg = `Review started in background. Job ID: **${jobId}**\nCheck status: \`/gemini:status\``;
    if (options.json) { out(JSON.stringify({ jobId, status: "running" })); }
    else { out(msg); }
    return;
  }

  // Foreground: run gemini directly
  const geminiArgs = buildGeminiArgs({
    model: options.model,
    effort: options.effort,
    outputFormat: "text",
    prompt,
  });

  const result = runGemini(geminiArgs, { cwd, timeout: 300000 });
  const rawOutput = result.stdout;
  const parsed = parseStructuredOutput(rawOutput);

  if (options.json) {
    out(JSON.stringify({ verdict: parsed.parsed?.verdict, summary: parsed.parsed?.summary, findings: parsed.parsed?.findings ?? [], rawOutput }));
  } else if (parsed.parsed) {
    out(renderReviewResult(parsed.parsed, { model: options.model }));
  } else {
    out(renderNativeReviewResult(rawOutput, { model: options.model }));
  }
}

async function cmdReview(args) { return runReview(args, "review"); }
async function cmdChallenge(args) { return runReview(args, "challenge"); }

// --- analyze ---
async function cmdAnalyze(args) {
  const { options, positionals } = parseArgs(args, {
    booleanOptions: ["background", "json"],
    valueOptions: ["model", "effort", "dirs", "files"],
  });

  const analysisType = positionals.join(" ").trim() || "Provide a comprehensive analysis of this codebase: architecture, patterns, quality, and areas for improvement.";
  const template = loadPromptTemplate(PLUGIN_ROOT, "analyze");
  const prompt = interpolateTemplate(template, {
    ANALYSIS_TYPE: analysisType,
    PROJECT_CONTEXT: `Working directory: ${cwd}`,
  });

  const geminiArgs = buildGeminiArgs({
    model: options.model,
    effort: options.effort,
    dirs: options.dirs,
    files: options.files,
    outputFormat: "text",
    prompt,
  });

  const result = runGemini(geminiArgs, { cwd, timeout: 600000 });
  const rawOutput = result.stdout;

  if (options.json) { out(JSON.stringify({ output: rawOutput })); }
  else { out(rawOutput); }
}

// --- task ---
async function cmdTask(args) {
  const { options, positionals } = parseArgs(args, {
    booleanOptions: ["background", "wait", "write", "resume-last", "json"],
    valueOptions: ["model", "effort"],
  });

  const prompt = positionals.join(" ").trim();
  if (!prompt) { err("Error: task requires a prompt"); process.exit(1); }

  if (options.background) {
    const jobId = generateJobId("task");
    const record = createJobRecord(jobId, "task", { prompt, model: options.model, effort: options.effort, write: options["write"] });
    upsertJob(workspaceRoot, record);

    const workerArgs = [
      path.join(PLUGIN_ROOT, "scripts", "gemini-companion.mjs"), "task-worker",
      "--job-id", jobId, "--prompt", prompt,
    ];
    if (options.model) { workerArgs.push("--model", options.model); }
    if (options.effort) { workerArgs.push("--effort", options.effort); }
    if (options["write"]) { workerArgs.push("--write"); }
    if (options["resume-last"]) { workerArgs.push("--resume-last"); }

    const worker = spawn("node", workerArgs, { cwd, detached: true, stdio: "ignore" });
    worker.unref();

    if (options.json) { out(JSON.stringify({ jobId, status: "running" })); }
    else { out(`Task started in background. Job ID: **${jobId}**\nCheck status: \`/gemini:status\``); }
    return;
  }

  // Foreground
  const geminiArgs = buildGeminiArgs({
    model: options.model,
    effort: options.effort,
    write: options["write"],
    resumeLatest: options["resume-last"],
    outputFormat: "text",
    prompt,
  });

  const result = runGemini(geminiArgs, { cwd, timeout: 600000 });
  const rawOutput = result.stdout;

  if (options.json) { out(JSON.stringify({ output: rawOutput })); }
  else { out(rawOutput); }
}

// --- task-worker (background child process) ---
async function cmdTaskWorker(args) {
  const { options, positionals } = parseArgs(args, {
    booleanOptions: ["write", "resume-last"],
    valueOptions: ["job-id", "prompt", "model", "effort"],
  });

  const jobId = options["job-id"];
  if (!jobId) { err("task-worker: --job-id required"); process.exit(1); }

  const prompt = options.prompt ?? positionals.join(" ").trim();
  const updateJob = createJobProgressUpdater(workspaceRoot, jobId);
  const logFile = createJobLogFile(workspaceRoot, jobId);
  const report = createProgressReporter(workspaceRoot, jobId, logFile);

  try {
    report("Task worker started");
    const geminiArgs = buildGeminiArgs({
      model: options.model || null,
      effort: options.effort || null,
      write: options["write"],
      resumeLatest: options["resume-last"],
      outputFormat: "text",
      prompt,
    });

    const result = runGemini(geminiArgs, { cwd, timeout: 600000 });
    const rawOutput = result.stdout;

    updateJob({ status: "done", completedAt: nowIso(), output: rawOutput });
    report("Task worker completed");
  } catch (error) {
    updateJob({ status: "error", completedAt: nowIso(), error: error.message });
  }
}

// --- task-resume-candidate ---
async function cmdTaskResumeCandidate(args) {
  const { options } = parseArgs(args, { booleanOptions: ["json"] });
  const jobs = listJobs(workspaceRoot);
  const taskJobs = jobs.filter((j) => j.class === "task" && j.status === "done");
  const latest = taskJobs.sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""))[0] ?? null;

  if (options.json) {
    out(JSON.stringify({ resumable: latest !== null, jobId: latest?.id ?? null }));
  } else {
    out(latest ? `Resumable task: ${latest.id}` : "No resumable task found.");
  }
}

// --- status ---
async function cmdStatus(args) {
  const { options, positionals } = parseArgs(args, {
    booleanOptions: ["all", "json"],
  });

  const jobId = positionals[0] ?? null;
  const snapshot = jobId
    ? buildSingleJobSnapshot(workspaceRoot, jobId)
    : buildStatusSnapshot(workspaceRoot, { all: options.all, jobId });

  if (options.json) {
    out(JSON.stringify(snapshot));
  } else if (jobId && snapshot) {
    out(renderJobStatusReport(snapshot.job));
  } else {
    out(renderStatusReport(snapshot ?? { jobs: [] }));
  }
}

// --- result ---
async function cmdResult(args) {
  const { options, positionals } = parseArgs(args, { booleanOptions: ["json"] });
  const jobId = positionals[0] ?? null;
  const { job, error } = resolveResultJob(workspaceRoot, jobId);

  if (error) {
    if (options.json) { out(JSON.stringify({ error })); } else { err(error); }
    process.exit(1);
  }

  const stored = readJobFile(workspaceRoot, job.id);
  const output = stored?.output ?? stored?.result ?? job.lastMessage ?? "(no output)";

  if (options.json) {
    out(JSON.stringify({ jobId: job.id, status: job.status, output }));
  } else {
    out(renderTaskResult({ output }, { jobId: job.id }));
  }
}

// --- cancel ---
async function cmdCancel(args) {
  const { options, positionals } = parseArgs(args, { booleanOptions: ["json"] });
  const jobId = positionals[0] ?? null;
  const { job, error } = resolveCancelableJob(workspaceRoot, jobId);

  if (error) {
    if (options.json) { out(JSON.stringify({ error })); } else { err(error); }
    process.exit(1);
  }

  if (job.pid) terminateProcessTree(job.pid);
  upsertJob(workspaceRoot, { id: job.id, status: "cancelled", completedAt: nowIso() });
  const updated = { ...job, status: "cancelled" };

  if (options.json) { out(JSON.stringify({ jobId: job.id, status: "cancelled" })); }
  else { out(renderCancelReport(updated)); }
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

const handler = commands[subcommand];
if (!handler) {
  err(`Unknown subcommand: ${subcommand}`);
  err(`Available: ${Object.keys(commands).join(", ")}`);
  process.exit(1);
}

try {
  await handler(rawArgs);
} catch (e) {
  err(`Error: ${e.message}`);
  process.exit(1);
}
