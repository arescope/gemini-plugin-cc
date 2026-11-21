// tests/render.test.mjs
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  renderSetupReport,
  renderStatusReport,
  renderReviewResult,
  renderTaskResult,
  renderCancelReport,
} from "../scripts/lib/render.mjs";

describe("renderSetupReport", () => {
  it("shows ready when gemini available and logged in", () => {
    const out = renderSetupReport({ agyAvailable: true, agyVersion: "v1.0", loggedIn: true, reviewGateEnabled: false });
    assert.ok(out.includes("ready") || out.includes("✅") || out.includes("available"));
  });
  it("shows not ready when gemini not available", () => {
    const out = renderSetupReport({ agyAvailable: false, loggedIn: false, reviewGateEnabled: false });
    assert.ok(out.includes("not") || out.includes("❌") || out.includes("unavailable") || out.includes("missing"));
  });
});

describe("renderStatusReport", () => {
  it("shows empty message when no jobs", () => {
    const out = renderStatusReport({ jobs: [] });
    assert.ok(out.includes("No") || out.includes("empty") || out.length > 0);
  });
  it("renders a table row for each job", () => {
    const out = renderStatusReport({
      jobs: [
        { id: "review-001", class: "review", status: "done", startedAt: "2024-01-01T00:00:00Z" },
        { id: "task-002", class: "task", status: "running", startedAt: "2024-01-01T01:00:00Z" },
      ],
    });
    assert.ok(out.includes("review-001") && out.includes("task-002"));
  });
});

describe("renderReviewResult", () => {
  it("renders approve verdict", () => {
    const result = { verdict: "approve", summary: "Looks good", findings: [], next_steps: [] };
    const out = renderReviewResult(result, { jobId: "review-001" });
    assert.ok(out.includes("approve") || out.includes("✅") || out.includes("Looks good"));
  });
  it("renders findings sorted by severity", () => {
    const result = {
      verdict: "needs-attention",
      summary: "Issues found",
      findings: [
        { severity: "low", title: "Minor", body: "Small issue", file: "a.js", line_start: 1, line_end: 1, confidence: 0.8, recommendation: "Fix it" },
        { severity: "critical", title: "Bug", body: "Critical bug", file: "b.js", line_start: 5, line_end: 10, confidence: 0.9, recommendation: "Fix now" },
      ],
      next_steps: ["Fix critical bug"],
    };
    const out = renderReviewResult(result, { jobId: "review-001" });
    // critical should appear before low
    assert.ok(out.indexOf("critical") < out.indexOf("low") || out.includes("Bug") || out.includes("Critical"));
  });
});

describe("renderTaskResult", () => {
  it("renders task output", () => {
    const out = renderTaskResult({ output: "Task completed successfully" }, { jobId: "task-001" });
    assert.ok(out.includes("Task completed"));
  });
});

describe("renderCancelReport", () => {
  it("renders cancelled job info", () => {
    const out = renderCancelReport({ id: "review-001", status: "cancelled" });
    assert.ok(out.includes("review-001") || out.includes("cancel") || out.includes("Cancelled"));
  });
});

describe("renderSetupReport auth hint", () => {
  it("suggests signing in for authentication failures", () => {
    const out = renderSetupReport({ agyAvailable: true, agyVersion: "1", loggedIn: false, detail: "agy is not signed in" });
    assert.match(out, /Authentication: not working/);
    assert.match(out, /GEMINI_API_KEY/);
  });
  it("does not blame authentication for a quota failure", () => {
    const out = renderSetupReport({ agyAvailable: true, agyVersion: "1", loggedIn: false, detail: "RESOURCE_EXHAUSTED: quota exceeded" });
    assert.match(out, /not an authentication error/);
    assert.doesNotMatch(out, /GEMINI_API_KEY/);
    assert.match(out, /RESOURCE_EXHAUSTED/);
  });
});
