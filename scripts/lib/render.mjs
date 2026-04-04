// scripts/lib/render.mjs

const SEVERITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

export function renderSetupReport(report) {
  const lines = ["## Gemini Plugin Setup"];
  lines.push(report.geminiAvailable
    ? `✅ Gemini CLI: available (${report.geminiVersion ?? "unknown version"})`
    : "❌ Gemini CLI: not available — run `npm install -g @google/generative-ai-cli` or check your PATH");
  lines.push(report.loggedIn
    ? "✅ Authentication: logged in"
    : "❌ Authentication: not logged in — run `gemini auth login`");
  lines.push(report.reviewGateEnabled
    ? "✅ Stop review gate: enabled"
    : "ℹ️  Stop review gate: disabled");
  if (report.detail) lines.push(`\n> ${report.detail}`);
  const ready = report.geminiAvailable && report.loggedIn;
  lines.push(`\n**Status:** ${ready ? "✅ Ready" : "❌ Not ready"}`);
  return lines.join("\n");
}

export function renderStatusReport(report) {
  if (!report.jobs || report.jobs.length === 0) {
    return "No jobs found.";
  }
  const header = "| ID | Class | Status | Started |";
  const sep = "| --- | --- | --- | --- |";
  const rows = report.jobs.map((j) =>
    `| ${j.id} | ${j.class ?? "-"} | ${j.status} | ${j.startedAt ?? "-"} |`
  );
  return [header, sep, ...rows].join("\n");
}

export function renderReviewResult(result, meta = {}) {
  const lines = [`## Review Result${meta.jobId ? ` (${meta.jobId})` : ""}`];
  const verdict = result.verdict === "approve" ? "✅ approve" : "⚠️  needs-attention";
  lines.push(`**Verdict:** ${verdict}`);
  lines.push(`**Summary:** ${result.summary}`);
  if (result.findings && result.findings.length > 0) {
    lines.push("\n### Findings");
    const sorted = [...result.findings].sort(
      (a, b) => (SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99)
    );
    for (const f of sorted) {
      lines.push(`\n#### [${f.severity.toUpperCase()}] ${f.title}`);
      lines.push(`**File:** ${f.file}:${f.line_start}–${f.line_end} | **Confidence:** ${Math.round(f.confidence * 100)}%`);
      lines.push(f.body);
      lines.push(`**Recommendation:** ${f.recommendation}`);
    }
  }
  if (result.next_steps && result.next_steps.length > 0) {
    lines.push("\n### Next Steps");
    result.next_steps.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
  }
  return lines.join("\n");
}

export function renderNativeReviewResult(result, meta = {}) {
  const lines = [`## Review Result${meta.jobId ? ` (${meta.jobId})` : ""}`];
  const text = typeof result === "string" ? result : JSON.stringify(result, null, 2);
  lines.push(sanitizeModelOutput(text));
  return lines.join("\n");
}

/**
 * Strip content that looks like prompt injection from model output.
 * This prevents a compromised Gemini response from injecting instructions
 * that Claude might follow when the output is presented in conversation.
 */
export function sanitizeModelOutput(text) {
  if (!text) return text;
  // Strip XML-style role/system/instruction tags that could be interpreted as directives
  let sanitized = text.replace(/<\/?(?:system|instruction|role|task|prompt|command|override|ignore)[^>]*>/gi, "");
  // Strip markdown-style "system:" or "instruction:" prefixed blocks
  sanitized = sanitized.replace(/^(?:system|instruction|override)\s*:\s*.+$/gim, "");
  return sanitized;
}

export function renderTaskResult(result, meta = {}) {
  const lines = [`## Task Result${meta.jobId ? ` (${meta.jobId})` : ""}`];
  const text = result.output ?? result.rawOutput ?? JSON.stringify(result);
  lines.push(sanitizeModelOutput(text));
  return lines.join("\n");
}

export function renderJobStatusReport(job) {
  const lines = [`## Job ${job.id}`];
  lines.push(`**Status:** ${job.status}`);
  if (job.class) lines.push(`**Type:** ${job.class}`);
  if (job.startedAt) lines.push(`**Started:** ${job.startedAt}`);
  if (job.completedAt) lines.push(`**Completed:** ${job.completedAt}`);
  if (job.lastMessage) lines.push(`**Last message:** ${job.lastMessage}`);
  if (job.error) lines.push(`**Error:** ${job.error}`);
  return lines.join("\n");
}

export function renderCancelReport(job) {
  if (!job) return "No job to cancel.";
  return `Cancelled job **${job.id}** (was: ${job.status})`;
}

export function renderStoredJobResult(job, storedJob) {
  const lines = [`## Stored Result for ${job.id}`];
  lines.push(`**Status:** ${job.status}`);
  if (storedJob?.output) lines.push(storedJob.output);
  else if (storedJob?.result) lines.push(typeof storedJob.result === "string" ? storedJob.result : JSON.stringify(storedJob.result, null, 2));
  else lines.push("(no stored output)");
  if (storedJob?.error) lines.push(`\n**Error:** ${storedJob.error}`);
  return lines.join("\n");
}
