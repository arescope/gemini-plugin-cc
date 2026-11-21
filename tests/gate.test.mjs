// tests/gate.test.mjs
// Stop review gate: timeouts, fail-open failures, empty results and the
// read-only guarantee, driven through a fake `agy` binary.
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createTempDir, cleanTempDir, initGitRepo } from "./helpers.mjs";
import { installFakeAgy, fakeAgyEnv, readFakeAgyCalls } from "./fake-agy-fixture.mjs";
import { gateTimeoutMs } from "../scripts/stop-review-gate-hook.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.resolve(__dirname, "..", "scripts");
const COMPANION = path.join(SCRIPTS, "gemini-companion.mjs");
const GATE_HOOK = path.join(SCRIPTS, "stop-review-gate-hook.mjs");

function run(script, args, { cwd, env, input = "" } = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd, env: env ?? process.env, encoding: "utf8", timeout: 60000, input,
  });
}

describe("gateTimeoutMs", () => {
  it("defaults to 780000", () => assert.equal(gateTimeoutMs({}), 780000));
  it("honours a positive override", () => assert.equal(gateTimeoutMs({ GEMINI_GATE_TIMEOUT_MS: "1500" }), 1500));
  it("ignores invalid values", () => {
    assert.equal(gateTimeoutMs({ GEMINI_GATE_TIMEOUT_MS: "-5" }), 780000);
    assert.equal(gateTimeoutMs({ GEMINI_GATE_TIMEOUT_MS: "abc" }), 780000);
  });
});

describe("stop review gate failure handling", () => {
  let tmp, binDir, env;
  beforeEach(() => {
    tmp = createTempDir(); binDir = path.join(tmp, "bin"); initGitRepo(tmp);
    fs.writeFileSync(path.join(tmp, ".gitignore"), "bin/\n");
    spawnSync("git", ["add", ".gitignore"], { cwd: tmp });
    spawnSync("git", ["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-m", "ignore"], { cwd: tmp });
    installFakeAgy(binDir, "gate-allow");
    env = fakeAgyEnv(binDir);
  });
  afterEach(() => { cleanTempDir(tmp); });

  const gate = (extraEnv = {}) => run(GATE_HOOK, [], {
    cwd: tmp, env: { ...env, ...extraEnv }, input: JSON.stringify({ last_assistant_message: "Edited a.js" }),
  });
  const enable = () => run(COMPANION, ["setup", "--enable-review-gate", "--json"], { cwd: tmp, env });
  const gateCalls = () => readFakeAgyCalls(binDir).filter((c) => c.prompt.includes("stop-gate review"));
  const dirty = (content = "let a;\n") => fs.writeFileSync(path.join(tmp, "a.js"), content);

  it("stores the fingerprint on timeout so the slow review is not rerun", () => {
    enable(); dirty();
    installFakeAgy(binDir, "slow");
    const first = JSON.parse(gate({ GEMINI_GATE_TIMEOUT_MS: "1000" }).stdout.trim());
    assert.equal(first.decision, undefined);
    assert.match(first.systemMessage, /timed out/);
    assert.match(first.systemMessage, /\/gemini:review/);
    assert.equal(gateCalls().length, 1);
    const second = gate({ GEMINI_GATE_TIMEOUT_MS: "1000" });
    assert.equal(second.stdout.trim(), "");
    assert.equal(gateCalls().length, 1, "agy must not run again for the same changes");
  });

  it("does not store the fingerprint on an auth failure, so it retries", () => {
    enable(); dirty();
    installFakeAgy(binDir, "auth-error");
    const payload = JSON.parse(gate().stdout.trim());
    assert.match(payload.systemMessage, /review gate skipped/);
    assert.doesNotMatch(payload.systemMessage, /will not be retried/);
    gate();
    assert.equal(gateCalls().length, 2);
  });

  it("allows silently and stores the fingerprint on an empty result", () => {
    enable(); dirty();
    installFakeAgy(binDir, "empty-success");
    assert.equal(gate().stdout.trim(), "");
    assert.equal(gate().stdout.trim(), "");
    assert.equal(gateCalls().length, 1);
  });

  it("warns without blocking when the read-only guarantee is violated", () => {
    enable(); dirty();
    installFakeAgy(binDir, "auto-mode");
    const payload = JSON.parse(gate().stdout.trim());
    assert.equal(payload.decision, undefined);
    assert.match(payload.systemMessage, /WARNING/);
    gate();
    assert.equal(gateCalls().length, 2, "fingerprint must not be stored");
  });
});
