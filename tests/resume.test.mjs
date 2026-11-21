// tests/resume.test.mjs
// Task resume: only ever by a recorded conversation id, never agy's
// "most recent conversation".
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createTempDir, cleanTempDir, initGitRepo } from "./helpers.mjs";
import { installFakeAgy, fakeAgyEnv, readFakeAgyCalls } from "./fake-agy-fixture.mjs";
import { getConfig, setConfig, upsertJob, listJobs } from "../scripts/lib/state.mjs";

const COMPANION = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "scripts", "gemini-companion.mjs");
const companion = (args, { cwd, env }) => spawnSync(process.execPath, [COMPANION, ...args], { cwd, env, encoding: "utf8", timeout: 30000 });
const json = (r) => JSON.parse(r.stdout.trim());
const ID = "11111111-2222-3333-4444-555555555555";

async function waitFor(predicate, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("waitFor timed out");
}

describe("task resume", () => {
  let tmp, binDir, env;
  beforeEach(() => {
    tmp = createTempDir(); binDir = path.join(tmp, "bin"); initGitRepo(tmp);
    fs.writeFileSync(path.join(tmp, ".gitignore"), "bin/\n");
    spawnSync("git", ["add", ".gitignore"], { cwd: tmp });
    spawnSync("git", ["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-m", "ignore"], { cwd: tmp });
    installFakeAgy(binDir, "task-ok"); env = fakeAgyEnv(binDir);
  });
  afterEach(() => { cleanTempDir(tmp); });

  it("fails without calling agy when no conversation id is recorded", () => {
    const result = companion(["task", "--resume-last", "again"], { cwd: tmp, env });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /No previous task conversation to resume/);
    assert.equal(readFakeAgyCalls(binDir).length, 0);
    const bg = companion(["task", "--background", "--resume-last", "again"], { cwd: tmp, env });
    assert.equal(bg.status, 1);
    assert.equal(readFakeAgyCalls(binDir).length, 0);
  });

  it("is not resumable from a finished task job without a recorded id", () => {
    upsertJob(tmp, { id: "task-old", class: "task", status: "done", completedAt: new Date().toISOString() });
    const candidate = json(companion(["task-resume-candidate", "--json"], { cwd: tmp, env }));
    assert.equal(candidate.resumable, false);
    assert.equal(candidate.conversationId, null);
  });

  it("review and analyze runs record no id and leave the candidate false", () => {
    installFakeAgy(binDir, "review-ok");
    fs.writeFileSync(path.join(tmp, "a.js"), "let a;\n");
    companion(["review", "--json"], { cwd: tmp, env });
    companion(["analyze", "--json", "x"], { cwd: tmp, env });
    assert.equal(readFakeAgyCalls(binDir).length, 2);
    assert.equal(getConfig(tmp).lastTaskConversation, undefined);
    assert.equal(json(companion(["task-resume-candidate", "--json"], { cwd: tmp, env })).resumable, false);
  });

  it("records the id after a task and resumes with --conversation=<id>", () => {
    companion(["task", "--json", "first"], { cwd: tmp, env });
    assert.equal(getConfig(tmp).lastTaskConversation.id, ID);
    assert.equal(getConfig(tmp).lastTaskConversationId, undefined);
    const candidate = json(companion(["task-resume-candidate", "--json"], { cwd: tmp, env }));
    assert.deepEqual({ resumable: candidate.resumable, conversationId: candidate.conversationId }, { resumable: true, conversationId: ID });
    companion(["task", "--json", "--resume-last", "second"], { cwd: tmp, env });
    const second = readFakeAgyCalls(binDir)[1];
    assert.ok(second.args.includes(`--conversation=${ID}`));
    assert.ok(!second.args.includes("--continue"));
  });

  it("does not let an older-started background job overwrite a newer foreground task", async () => {
    setConfig(tmp, "lastTaskConversation", { id: "newer-fg", startedAt: new Date(Date.now() + 3600_000).toISOString() });
    const { jobId } = json(companion(["task", "--background", "--json", "x"], { cwd: tmp, env }));
    await waitFor(() => listJobs(tmp).find((j) => j.id === jobId)?.status === "done");
    assert.equal(getConfig(tmp).lastTaskConversation.id, "newer-fg");
  });

  it("a background task started later does overwrite the pointer", async () => {
    setConfig(tmp, "lastTaskConversation", { id: "older", startedAt: "2000-01-01T00:00:00.000Z" });
    const { jobId } = json(companion(["task", "--background", "--json", "x"], { cwd: tmp, env }));
    await waitFor(() => listJobs(tmp).find((j) => j.id === jobId)?.status === "done");
    assert.equal(getConfig(tmp).lastTaskConversation.id, ID);
  });

  it("a failed resume carries a hint, keeps the pointer, and does not retry", () => {
    const pointer = { id: "stale-id", startedAt: "2000-01-01T00:00:00.000Z" };
    setConfig(tmp, "lastTaskConversation", pointer);
    installFakeAgy(binDir, "unknown-model");
    const result = companion(["task", "--resume-last", "again"], { cwd: tmp, env });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /run the task without --resume-last to start a new one/);
    assert.deepEqual(getConfig(tmp).lastTaskConversation, pointer);
    const calls = readFakeAgyCalls(binDir);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].args.includes("--conversation=stale-id"));
    // Running without --resume-last unsticks the user.
    installFakeAgy(binDir, "task-ok");
    assert.equal(companion(["task", "fresh"], { cwd: tmp, env }).status, 0);
    assert.equal(getConfig(tmp).lastTaskConversation.id, ID);
  });
});
