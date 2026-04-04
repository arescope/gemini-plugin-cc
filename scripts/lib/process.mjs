// scripts/lib/process.mjs
import { spawnSync, execFileSync } from "node:child_process";

export function binaryAvailable(binary, versionArgs = ["--version"], options = {}) {
  try {
    const result = spawnSync(binary, versionArgs, {
      cwd: options.cwd ?? process.cwd(), encoding: "utf8", timeout: 10000, stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });
    if (result.error || result.status !== 0) return { available: false };
    const version = (result.stdout || result.stderr || "").trim().split(/\r?\n/)[0] || null;
    return { available: true, version };
  } catch { return { available: false }; }
}

export function runCommand(command, args = [], options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? process.cwd(), encoding: "utf8", timeout: options.timeout ?? 60000, stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
  });
  return { status: result.status ?? 1, stdout: (result.stdout ?? "").trim(), stderr: (result.stderr ?? "").trim() };
}

export function terminateProcessTree(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return;
  try {
    if (process.platform === "win32") {
      execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      process.kill(-pid, "SIGTERM");
    }
  } catch {
    try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ }
  }
}
