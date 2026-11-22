// tests/process.test.mjs
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { binaryAvailable, terminateProcessTree, isProcessAlive, parseProcStatState } from "../scripts/lib/process.mjs";

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

describe("parseProcStatState", () => {
  it("parses a simple stat line", () => assert.equal(parseProcStatState("123 (node) S 1 2 3"), "S"));
  it("handles spaces and parens in comm", () => assert.equal(parseProcStatState("123 (a) b (c)) Z 1 2"), "Z"));
  it("returns null for garbage", () => assert.equal(parseProcStatState("nonsense"), null));
});

describe("isProcessAlive", () => {
  it("is true for this process and false for invalid pids", () => {
    assert.equal(isProcessAlive(process.pid), true);
    assert.equal(isProcessAlive(0), false);
    assert.equal(isProcessAlive("x"), false);
  });
  it("treats zombie/dead states from the injected reader as dead", () => {
    if (process.platform !== "linux") return;
    assert.equal(isProcessAlive(process.pid, () => "Z"), false);
    assert.equal(isProcessAlive(process.pid, () => "X"), false);
    assert.equal(isProcessAlive(process.pid, () => "S"), true);
    assert.equal(isProcessAlive(process.pid, () => null), true);
  });
  it("treats a real zombie as dead", { skip: process.platform !== "linux" }, async () => {
    const parent = spawn("sh", ["-c", 'sh -c "exit 0" & echo $!; exec sleep 30'], { stdio: ["ignore", "pipe", "ignore"] });
    try {
      const pid = await new Promise((resolve, reject) => {
        let buf = "";
        parent.stdout.on("data", (d) => { buf += d; if (buf.includes("\n")) resolve(Number(buf.trim())); });
        parent.on("error", reject);
      });
      await new Promise((r) => setTimeout(r, 300));
      assert.equal(isProcessAlive(pid), false);
    } finally { parent.kill("SIGKILL"); }
  });
});
