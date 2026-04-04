// tests/helpers.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

export function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "gemini-test-"));
}

export function cleanTempDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

export function initGitRepo(dir) {
  execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" });
  execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@test.com", "commit", "--allow-empty", "-m", "init"], { cwd: dir, stdio: "ignore" });
  return dir;
}
