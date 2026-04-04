// tests/process.test.mjs
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { binaryAvailable, terminateProcessTree } from "../scripts/lib/process.mjs";

describe("binaryAvailable", () => {
  it("detects node as available", () => {
    const result = binaryAvailable("node", ["--version"]);
    assert.equal(result.available, true);
    assert.ok(result.version);
  });
  it("detects nonexistent binary as unavailable", () => {
    const result = binaryAvailable("__nonexistent_xyz__", ["--version"]);
    assert.equal(result.available, false);
  });
});

describe("terminateProcessTree", () => {
  it("does not throw for invalid PID", () => {
    assert.doesNotThrow(() => terminateProcessTree(NaN));
    assert.doesNotThrow(() => terminateProcessTree(-1));
  });
});
