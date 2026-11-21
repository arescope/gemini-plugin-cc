// scripts/lib/process.mjs
import { spawnSync, execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const MAX_BUFFER = 64 * 1024 * 1024;

/**
 * @param {string} binary
 * @param {string[]} [versionArgs]
 * @param {{ cwd?: string }} [options]
 * @returns {{ available: boolean, version?: string | null }}
 */
export function binaryAvailable(binary, versionArgs = ["--version"], options = {}) {
  try {
    const result = spawnSync(binary, versionArgs, {
      cwd: options.cwd ?? process.cwd(), encoding: "utf8", timeout: 15000, stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    if (result.error || result.status !== 0) return { available: false };
    const version = (result.stdout || result.stderr || "").trim().split(/\r?\n/)[0] || null;
    return { available: true, version };
  } catch { return { available: false }; }
}

/**
 * @param {string} command
 * @param {string[]} [args]
 * @param {{ cwd?: string, timeout?: number }} [options]
 */
export function runCommand(command, args = [], options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? process.cwd(), encoding: "utf8", timeout: options.timeout ?? 60000, stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: MAX_BUFFER,
    windowsHide: true,
  });
  return { status: result.status ?? 1, stdout: (result.stdout ?? "").trim(), stderr: (result.stderr ?? "").trim() };
}

/**
 * Extract the state letter from the text of /proc/<pid>/stat. The comm field
 * is parenthesised and may itself contain spaces or parens, so the state is
 * the first field after the LAST ")".
 * @param {string} text
 * @returns {string | null}
 */
export function parseProcStatState(text) {
  const end = String(text ?? "").lastIndexOf(")");
  if (end < 0) return null;
  const match = text.slice(end + 1).match(/^\s+(\S)/);
  return match ? match[1] : null;
}

/** @param {number} pid @returns {string | null} */
function readProcState(pid) {
  try { return parseProcStatState(readFileSync(`/proc/${pid}/stat`, "utf8")); }
  catch { return null; }
}

/**
 * @param {unknown} pid
 * @param {(pid: number) => string | null} [readState] injectable for tests
 */
export function isProcessAlive(pid, readState = readProcState) {
  if (typeof pid !== "number" || !Number.isFinite(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); }
  catch (e) { return /** @type {NodeJS.ErrnoException} */ (e).code === "EPERM"; }
  // kill(0) succeeds for zombies (exited but unreaped); treat them as dead.
  if (process.platform === "linux") {
    const state = readState(pid);
    if (state === "Z" || state === "X") return false;
  }
  return true;
}

/**
 * Terminate a process and its children. Background workers are spawned
 * detached, so on POSIX their pid is also their process-group id.
 * @param {unknown} pid
 */
export function terminateProcessTree(pid) {
  if (typeof pid !== "number" || !Number.isFinite(pid) || pid <= 0) return;
  if (pid === process.pid) return;
  try {
    if (process.platform === "win32") {
      execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    } else {
      process.kill(-pid, "SIGTERM");
    }
  } catch {
    try { process.kill(pid, "SIGKILL"); } catch { /* already gone */ }
  }
}
