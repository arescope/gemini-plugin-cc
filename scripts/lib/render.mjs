// scripts/lib/render.mjs
import { INSTALL_HINT, AUTH_HINT, AUTH_ERROR_RE } from "./agy.mjs";

/** @type {Record<string, number>} */
const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

/** @param {{ agyAvailable: boolean, agyVersion?: string | null, loggedIn: boolean, detail?: string | null, reviewGateEnabled?: boolean }} report */
export function renderSetupReport(report) {
  const lines = ["## Gemini Plugin Setup"];
  lines.push(report.agyAvailable
    ? `✅ Antigravity CLI (agy): available (${report.agyVersion ?? "unknown version"})`
    : `❌ Antigravity CLI (agy): not available — install with \`${INSTALL_HINT}\` or check your PATH`);
  // Only suggest signing in when the failure is about authentication; a quota
  // or network error must be shown as what it is.
  const authRelated = !report.detail || AUTH_ERROR_RE.test(report.detail);
  lines.push(report.loggedIn
    ? "✅ Authentication: logged in"
    : !authRelated
      ? "❌ Authentication check failed (not an authentication error — see below)"
      : `❌ Authentication: not working${report.detail?.includes(AUTH_HINT) ? "" : ` — ${AUTH_HINT}`}`);
  lines.push(report.reviewGateEnabled
    ? "✅ Stop review gate: enabled"
    : "ℹ️  Stop review gate: disabled");
  if (report.detail) lines.push(`\n> ${report.detail}`);
  const ready = report.agyAvailable && report.loggedIn;
  lines.push(`\n**Status:** ${ready ? "✅ Ready" : "❌ Not ready"}`);
  return lines.join("\n");
}

/** @param {any} job */
export function formatJobDuration(job) {
  const start = Date.parse(job.startedAt ?? job.createdAt ?? "");
  if (Number.isNaN(start)) return "-";
  const end = job.completedAt ? Date.parse(job.completedAt) : Date.now();
  const secs = Math.max(0, Math.round((end - start) / 1000));
  return secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

/** @param {{ jobs?: any[] }} report */
export function renderStatusReport(report) {
  if (!report.jobs || report.jobs.length === 0) {
    return "No jobs found.";
  }
  const header = "| ID | Class | Status | Started | Duration | Detail |";
  const sep = "| --- | --- | --- | --- | --- | --- |";
  const cell = (/** @type {unknown} */ v) => String(v ?? "-").replace(/\|/g, "\\|").replace(/\s+/g, " ").slice(0, 80);
  const rows = report.jobs.map((j) =>
    `| ${j.id} | ${j.class ?? "-"} | ${j.status} | ${j.startedAt ?? "-"} | ${formatJobDuration(j)} | ${cell(j.error ?? j.lastMessage)} |`
  );
  const lines = [header, sep, ...rows];
  if (report.jobs.some((j) => j.status === "running")) lines.push("", "Cancel a running job with `/gemini:cancel [job-id]`.");
  if (report.jobs.some((j) => j.status === "done" || j.status === "error")) lines.push("", "Fetch output with `/gemini:result [job-id]`.");
  return lines.join("\n");
}

/** @param {any} result @param {{ jobId?: string, model?: string | null }} [meta] */
export function renderReviewResult(result, meta = {}) {
  const lines = [`## Review Result${meta.jobId ? ` (${meta.jobId})` : ""}`];
  const verdict = result.verdict === "approve" ? "✅ approve" : "⚠️  needs-attention";
  lines.push(`**Verdict:** ${verdict}`);
  lines.push(`**Summary:** ${result.summary ?? "(none)"}`);
  if (Array.isArray(result.findings) && result.findings.length > 0) {
    lines.push("\n### Findings");
    const sorted = [...result.findings].sort(
      (a, b) => (SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99)
    );
    for (const f of sorted) {
      // Model output is not guaranteed to honour the schema — render what is there.
      lines.push(`\n#### [${String(f.severity ?? "unknown").toUpperCase()}] ${f.title ?? "Untitled finding"}`);
      const meta = [];
      if (f.file) {
        const range = f.line_start == null ? "" : `:${f.line_start}${f.line_end != null && f.line_end !== f.line_start ? `–${f.line_end}` : ""}`;
        meta.push(`**File:** ${f.file}${range}`);
      }
      if (typeof f.confidence === "number" && Number.isFinite(f.confidence)) meta.push(`**Confidence:** ${Math.round(f.confidence * 100)}%`);
      if (meta.length > 0) lines.push(meta.join(" | "));
      if (f.body) lines.push(String(f.body));
      if (f.recommendation) lines.push(`**Recommendation:** ${f.recommendation}`);
    }
  }
  if (Array.isArray(result.next_steps) && result.next_steps.length > 0) {
    lines.push("\n### Next Steps");
    result.next_steps.forEach((/** @type {unknown} */ s, /** @type {number} */ i) => lines.push(`${i + 1}. ${s}`));
  }
  return lines.join("\n");
}

/** @param {unknown} result @param {{ jobId?: string, model?: string | null }} [meta] */
export function renderNativeReviewResult(result, meta = {}) {
  const lines = [`## Review Result${meta.jobId ? ` (${meta.jobId})` : ""}`];
  const text = typeof result === "string" ? result : JSON.stringify(result, null, 2);
  lines.push(text);
  return lines.join("\n");
}

/** @param {{ output?: string, rawOutput?: string }} result @param {{ jobId?: string, model?: string | null }} [meta] */
export function renderTaskResult(result, meta = {}) {
  const lines = [`## Task Result${meta.jobId ? ` (${meta.jobId})` : ""}`];
  const text = result.output ?? result.rawOutput ?? JSON.stringify(result);
  lines.push(text);
  return lines.join("\n");
}

/** @param {any} job */
export function renderJobStatusReport(job) {
  const lines = [`## Job ${job.id}`];
  lines.push(`**Status:** ${job.status}`);
  if (job.class) lines.push(`**Type:** ${job.class}`);
  if (job.model) lines.push(`**Model:** ${job.model}`);
  if (job.startedAt) lines.push(`**Started:** ${job.startedAt}`);
  lines.push(`**Duration:** ${formatJobDuration(job)}`);
  if (job.completedAt) lines.push(`**Completed:** ${job.completedAt}`);
  if (job.lastMessage) lines.push(`**Last message:** ${job.lastMessage}`);
  if (job.error) lines.push(`**Error:** ${job.error}`);
  if (job.promptPreview) lines.push(`**Prompt:** ${job.promptPreview}${job.promptPreview.length >= 200 ? "…" : ""}`);
  if (Array.isArray(job.progress) && job.progress.length > 0) lines.push("\n**Recent log:**", "```", ...job.progress, "```");
  return lines.join("\n");
}

/** @param {any} job */
export function renderCancelReport(job) {
  if (!job) return "No job to cancel.";
  return `Cancelled job **${job.id}** (was: ${job.status})`;
}
