// tests/helpers.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

export function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "gemini-test-"));
}

export function cleanTempDir(dir) {
  // On Windows a just-finished background worker can still hold the directory
  // as its cwd for a moment, so rmdir fails with EBUSY/EPERM; rmSync retries
  // those (with linear backoff) when maxRetries is set.
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}

export function initGitRepo(dir) {
  execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@test.com", "commit", "--allow-empty", "-m", "init"], { cwd: dir, stdio: "ignore" });
  return dir;
}
