// tests/state.test.mjs
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
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
  it("updates on upsert", () => { upsertJob(tmp, { id: "t-1", status: "running" }); upsertJob(tmp, { id: "t-1", status: "done" }); assert.equal(listJobs(tmp).length, 1); assert.equal(listJobs(tmp)[0].status, "done"); });
});
