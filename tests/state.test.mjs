// tests/state.test.mjs
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createTempDir, cleanTempDir } from "./helpers.mjs";
import { loadState, saveState, getConfig, setConfig, generateJobId, upsertJob, listJobs } from "../scripts/lib/state.mjs";

describe("state", () => {
  let tmp;
  beforeEach(() => { tmp = createTempDir(); });
  afterEach(() => { cleanTempDir(tmp); });
  it("returns empty for missing file", () => { const s = loadState(tmp); assert.deepEqual(s.jobs, []); assert.deepEqual(s.config, {}); });
  it("round-trips", () => { const s = { jobs: [{ id: "t-1" }], config: { x: true } }; saveState(tmp, s); assert.deepEqual(loadState(tmp), s); });
});

describe("config", () => {
  let tmp;
  beforeEach(() => { tmp = createTempDir(); });
  afterEach(() => { cleanTempDir(tmp); });
  it("gets and sets", () => { setConfig(tmp, "stopReviewGate", true); assert.equal(getConfig(tmp).stopReviewGate, true); });
});

describe("jobs", () => {
  let tmp;
  beforeEach(() => { tmp = createTempDir(); });
  afterEach(() => { cleanTempDir(tmp); });
  it("generates unique IDs", () => { const a = generateJobId("review"); const b = generateJobId("review"); assert.notEqual(a, b); });
  it("upserts and lists", () => { upsertJob(tmp, { id: "t-1", status: "running" }); upsertJob(tmp, { id: "r-1", status: "done" }); assert.equal(listJobs(tmp).length, 2); });
  it("breaks a stale lock left by a crashed process", () => {
    const lock = path.join(tmp, ".gemini-tasks", "state.lock");
    fs.mkdirSync(lock, { recursive: true });
    const old = new Date(Date.now() - 60_000); fs.utimesSync(lock, old, old);
    upsertJob(tmp, { id: "t-1", status: "done" });
    assert.equal(listJobs(tmp)[0].status, "done");
    assert.equal(fs.existsSync(lock), false);
  });
  it("updates on upsert", () => { upsertJob(tmp, { id: "t-1", status: "running" }); upsertJob(tmp, { id: "t-1", status: "done" }); assert.equal(listJobs(tmp).length, 1); assert.equal(listJobs(tmp)[0].status, "done"); });
});

describe("concurrent updates", () => {
  let tmp;
  beforeEach(() => { tmp = createTempDir(); });
  afterEach(() => { cleanTempDir(tmp); });
  it("keeps every job when many processes upsert at once", async () => {
    const stateUrl = new URL("../scripts/lib/state.mjs", import.meta.url).href;
    const run = (id) => new Promise((resolve, reject) => {
      const code = `import { upsertJob } from ${JSON.stringify(stateUrl)};
        for (let i = 0; i < 5; i++) upsertJob(${JSON.stringify(tmp)}, { id: ${JSON.stringify(id)}, status: "running", n: i });
        upsertJob(${JSON.stringify(tmp)}, { id: ${JSON.stringify(id)}, status: "done" });`;
      const child = spawn(process.execPath, ["--input-type=module", "-e", code], { stdio: ["ignore", "ignore", "inherit"] });
      child.on("error", reject);
      child.on("exit", (status) => status === 0 ? resolve() : reject(new Error(`${id} exited ${status}`)));
    });
    const ids = Array.from({ length: 10 }, (_, i) => `job-${i}`);
    await Promise.all(ids.map(run));
    const jobs = listJobs(tmp);
    assert.deepEqual(jobs.map((j) => j.id).sort(), ids.slice().sort());
    assert.ok(jobs.every((j) => j.status === "done"));
  });
});
