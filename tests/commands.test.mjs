// tests/commands.test.mjs
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createTempDir, cleanTempDir } from "./helpers.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMPANION = path.resolve(__dirname, "..", "scripts", "gemini-companion.mjs");

function runCompanion(args, options = {}) {
  return spawnSync("node", [COMPANION, ...args], {
    cwd: options.cwd ?? process.cwd(),
    encoding: "utf8",
    timeout: 30000,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

describe("setup --json", () => {
  it("returns valid JSON", () => {
    const result = runCompanion(["setup", "--json"]);
    // agy may not be installed in CI — status 0 or 1, but output must be JSON
    const output = result.stdout.trim();
    assert.ok(output.length > 0, "Should produce output");
    const parsed = JSON.parse(output);
    assert.ok(typeof parsed.agyAvailable === "boolean");
    assert.ok(typeof parsed.reviewGateEnabled === "boolean");
  });
});

describe("status --json", () => {
  let tmp;
  beforeEach(() => { tmp = createTempDir(); });
  afterEach(() => { cleanTempDir(tmp); });

  it("returns empty jobs array for new workspace", () => {
    const result = runCompanion(["status", "--json"], { cwd: tmp });
    assert.equal(result.status, 0);
    const parsed = JSON.parse(result.stdout.trim());
    assert.ok(Array.isArray(parsed.jobs));
    assert.equal(parsed.jobs.length, 0);
  });
});

describe("cancel --json", () => {
  let tmp;
  beforeEach(() => { tmp = createTempDir(); });
  afterEach(() => { cleanTempDir(tmp); });

  it("returns error when no running jobs", () => {
    const result = runCompanion(["cancel", "--json"], { cwd: tmp });
    assert.equal(result.status, 1);
    const parsed = JSON.parse(result.stdout.trim());
    assert.ok(parsed.error);
  });
});

describe("result --json", () => {
  let tmp;
  beforeEach(() => { tmp = createTempDir(); });
  afterEach(() => { cleanTempDir(tmp); });

  it("returns error when no completed jobs", () => {
    const result = runCompanion(["result", "--json"], { cwd: tmp });
    assert.equal(result.status, 1);
    const parsed = JSON.parse(result.stdout.trim());
    assert.ok(parsed.error);
  });
});

describe("task-resume-candidate --json", () => {
  let tmp;
  beforeEach(() => { tmp = createTempDir(); });
  afterEach(() => { cleanTempDir(tmp); });

  it("returns resumable: false for empty state", () => {
    const result = runCompanion(["task-resume-candidate", "--json"], { cwd: tmp });
    assert.equal(result.status, 0);
    const parsed = JSON.parse(result.stdout.trim());
    assert.equal(parsed.resumable, false);
    assert.equal(parsed.jobId, null);
  });
});

describe("unknown subcommand", () => {
  it("exits with status 1 and error message", () => {
    const result = runCompanion(["__unknown__"]);
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes("Unknown subcommand"));
  });
});
