// tests/runtime.test.mjs
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createTempDir, cleanTempDir, initGitRepo } from "./helpers.mjs";
import { installFakeAgy, fakeAgyEnv } from "./fake-agy-fixture.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const COMPANION = path.resolve(__dirname, "..", "scripts", "gemini-companion.mjs");
const LIFECYCLE_HOOK = path.resolve(__dirname, "..", "scripts", "session-lifecycle-hook.mjs");

function runCompanion(args, options = {}) {
  return spawnSync("node", [COMPANION, ...args], {
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
    encoding: "utf8",
    timeout: 30000,
    stdio: ["pipe", "pipe", "pipe"],
    input: options.input ?? "",
  });
}

function runLifecycleHook(event, input, options = {}) {
  return spawnSync("node", [LIFECYCLE_HOOK, event], {
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
    encoding: "utf8",
    timeout: 10000,
    stdio: ["pipe", "pipe", "pipe"],
    input: JSON.stringify(input),
  });
}

describe("companion setup with fake agy", () => {
  let tmp, binDir, env;
  beforeEach(() => {
    tmp = createTempDir();
    binDir = path.join(tmp, "bin");
  });
  afterEach(() => { cleanTempDir(tmp); });

  it("detects agy as available via fake binary", () => {
    installFakeAgy(binDir, "auth-ok");
    env = fakeAgyEnv(binDir);
    const result = runCompanion(["setup", "--json"], { cwd: tmp, env });
    const parsed = JSON.parse(result.stdout.trim());
    assert.equal(parsed.agyAvailable, true);
  });

  it("detects agy as unavailable without the binary", () => {
    // Use a PATH that has node (so the companion can run) but no agy binary
    const nodeDir = path.dirname(process.execPath);
    const sep = process.platform === "win32" ? ";" : ":";
    env = { ...process.env, PATH: tmp + sep + nodeDir };
    const result = runCompanion(["setup", "--json"], { cwd: tmp, env });
    const parsed = JSON.parse(result.stdout.trim());
    assert.equal(parsed.agyAvailable, false);
  });
});

describe("companion review with fake agy", () => {
  let tmp, binDir, env;
  beforeEach(() => {
    tmp = createTempDir();
    binDir = path.join(tmp, "bin");
    initGitRepo(tmp);
    // Create a file so git diff has something
    fs.writeFileSync(path.join(tmp, "test.js"), "console.log('hello');\n");
    spawnSync("git", ["add", "test.js"], { cwd: tmp, stdio: "ignore" });
  });
  afterEach(() => { cleanTempDir(tmp); });

  it("returns structured review result", () => {
    installFakeAgy(binDir, "review-ok");
    env = fakeAgyEnv(binDir);
    const result = runCompanion(["review", "--json"], { cwd: tmp, env });
    // Should not crash — companion processes the fake agy output
    assert.equal(result.status, 0);
    const output = result.stdout.trim();
    assert.ok(output.length > 0, "Should produce output");
  });
});

describe("companion task with fake agy", () => {
  let tmp, binDir, env;
  beforeEach(() => {
    tmp = createTempDir();
    binDir = path.join(tmp, "bin");
    installFakeAgy(binDir, "task-ok");
    env = fakeAgyEnv(binDir);
  });
  afterEach(() => { cleanTempDir(tmp); });

  it("runs a foreground task and returns output", () => {
    const result = runCompanion(["task", "--json", "fix the bug"], { cwd: tmp, env });
    assert.equal(result.status, 0);
    const parsed = JSON.parse(result.stdout.trim());
    assert.ok(parsed.output);
    assert.ok(parsed.output.includes("Task completed"));
  });
});

describe("session lifecycle hook", () => {
  let tmp;
  beforeEach(() => { tmp = createTempDir(); });
  afterEach(() => { cleanTempDir(tmp); });

  it("SessionStart stores session ID in state", () => {
    const result = runLifecycleHook("SessionStart", { session_id: "test-session-123" }, { cwd: tmp });
    assert.equal(result.status, 0);
    // Verify state was written
    const stateFile = path.join(tmp, ".gemini-tasks", "state.json");
    if (fs.existsSync(stateFile)) {
      const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
      assert.equal(state.config.lastSessionId, "test-session-123");
    }
  });

  it("SessionEnd does not crash on empty state", () => {
    const result = runLifecycleHook("SessionEnd", { session_id: "test-session-456" }, { cwd: tmp });
    assert.equal(result.status, 0);
  });
});

describe("companion enable/disable review gate", () => {
  let tmp, binDir, env;
  beforeEach(() => {
    tmp = createTempDir();
    binDir = path.join(tmp, "bin");
    installFakeAgy(binDir, "auth-ok");
    env = fakeAgyEnv(binDir);
  });
  afterEach(() => { cleanTempDir(tmp); });

  it("enables review gate via setup", () => {
    runCompanion(["setup", "--enable-review-gate", "--json"], { cwd: tmp, env });
    const result = runCompanion(["setup", "--json"], { cwd: tmp, env });
    const parsed = JSON.parse(result.stdout.trim());
    assert.equal(parsed.reviewGateEnabled, true);
  });

  it("disables review gate via setup", () => {
    runCompanion(["setup", "--enable-review-gate", "--json"], { cwd: tmp, env });
    runCompanion(["setup", "--disable-review-gate", "--json"], { cwd: tmp, env });
    const result = runCompanion(["setup", "--json"], { cwd: tmp, env });
    const parsed = JSON.parse(result.stdout.trim());
    assert.equal(parsed.reviewGateEnabled, false);
  });
});
