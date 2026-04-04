// tests/git.test.mjs
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createTempDir, cleanTempDir } from "./helpers.mjs";
import { ensureGitRepository, resolveReviewTarget } from "../scripts/lib/git.mjs";

describe("ensureGitRepository", () => {
  let tmpDir;
  beforeEach(() => { tmpDir = createTempDir(); });
  afterEach(() => { cleanTempDir(tmpDir); });

  it("throws for non-git directory", () => {
    assert.throws(() => ensureGitRepository(tmpDir), /not a git repository/i);
  });
  it("does not throw for git directory", () => {
    execFileSync("git", ["init"], { cwd: tmpDir, stdio: "ignore" });
    assert.doesNotThrow(() => ensureGitRepository(tmpDir));
  });
});

describe("resolveReviewTarget", () => {
  let tmpDir;
  beforeEach(() => {
    tmpDir = createTempDir();
    execFileSync("git", ["init"], { cwd: tmpDir, stdio: "ignore" });
    execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@test.com", "commit", "--allow-empty", "-m", "init"], { cwd: tmpDir, stdio: "ignore" });
  });
  afterEach(() => { cleanTempDir(tmpDir); });

  it("defaults to working-tree mode", () => {
    const target = resolveReviewTarget(tmpDir, {});
    assert.equal(target.mode, "working-tree");
  });
  it("uses branch mode when base is specified", () => {
    const target = resolveReviewTarget(tmpDir, { base: "main" });
    assert.equal(target.mode, "branch");
    assert.equal(target.baseRef, "main");
  });
});
