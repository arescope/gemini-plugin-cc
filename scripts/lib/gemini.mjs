// scripts/lib/gemini.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { binaryAvailable, runCommand } from "./process.mjs";

const MODEL_ALIASES = new Map([
  ["flash", "gemini-3-flash-preview"], ["fast", "gemini-3-flash-preview"],
  ["pro", "gemini-3.1-pro-preview"], ["deep", "gemini-3.1-pro-preview"],
  ["lite", "gemini-2.5-flash-lite"], ["flash-lite", "gemini-2.5-flash-lite"],
  ["flash-2", "gemini-2.5-flash"],
  ["pro-2", "gemini-2.5-pro"],
]);

const EFFORT_ALIASES = new Map([
  ["low", "low"], ["l", "low"],
  ["medium", "medium"], ["med", "medium"], ["m", "medium"],
  ["high", "high"], ["h", "high"],
  ["xhigh", "high"], ["xh", "high"], ["max", "high"],
  ["none", "none"], ["off", "none"]
]);

export function resolveModelAlias(alias) {
  if (alias == null) return null;
  const n = String(alias).trim().toLowerCase();
  if (!n) return null;
  return MODEL_ALIASES.get(n) ?? alias;
}

export function resolveEffort(effort) {
  if (effort == null) return null;
  const n = String(effort).trim().toLowerCase();
  if (!n) return null;
  return EFFORT_ALIASES.get(n) ?? n;
}

export function buildModelFlag(alias) {
  const resolved = resolveModelAlias(alias);
  return resolved ? ["--model", resolved] : [];
}

export function buildEffortFlag(effort) {
  const resolved = resolveEffort(effort);
  // --thinking-budget not available in current Gemini CLI; reserved for future use
  return [];
}

export function getGeminiAvailability(cwd) {
  return binaryAvailable("gemini", ["--version"], { cwd });
}

export function getGeminiLoginStatus(cwd) {
  const avail = getGeminiAvailability(cwd);
  if (!avail.available) return { available: false, loggedIn: false, detail: "Gemini CLI not installed" };
  // Use runGemini (not runCommand) so the prompt goes through the Windows-safe
  // temp-file stdin path instead of being mangled by cmd.exe.
  const args = buildGeminiArgs({ outputFormat: "text", prompt: "Reply with exactly: OK" });
  const result = runGemini(args, { cwd, timeout: 15000 });
  const loggedIn = result.status === 0 && result.stdout.includes("OK");
  return { available: true, loggedIn, detail: loggedIn ? null : "Authentication required" };
}

export function buildGeminiArgs(options) {
  const args = [];
  if (options.dirs) args.push("--include-directories", options.dirs);
  args.push(...buildModelFlag(options.model));
  args.push(...buildEffortFlag(options.effort));
  if (options.write) args.push("--yolo");
  if (options.plan) args.push("--approval-mode", "plan");
  if (options.resumeLatest) args.push("--resume", "latest");
  args.push("--output-format", options.outputFormat ?? "text");
  if (options.prompt) args.push("-p", options.prompt);
  return args;
}

/**
 * Run the Gemini CLI and return { status, stdout, stderr }.
 *
 * On Windows `shell: true` is required so Node can resolve the `gemini.cmd`
 * shim, but cmd.exe mangles arguments that contain special characters (XML
 * tags, pipes, quotes, etc.) and has an ~8 KB command-line length limit.
 *
 * To work around this, when running on Windows the prompt is written to a
 * temp file and fed to Gemini via shell input redirection (`< file`). The
 * `-p " "` flag switches Gemini into headless mode; the actual prompt comes
 * from stdin. The temp file is cleaned up after the process exits.
 */
export function runGemini(geminiArgs, { cwd, timeout = 300000 } = {}) {
  const isWin = process.platform === "win32";

  // Find the prompt in the args (value after "-p")
  const pIdx = geminiArgs.indexOf("-p");
  const prompt = pIdx !== -1 && pIdx + 1 < geminiArgs.length ? geminiArgs[pIdx + 1] : null;

  // When a prompt is present, write it to a temp file and feed it via stdin.
  //
  // On Windows this is required: `shell: true` is needed to resolve the
  // `gemini.cmd` shim, but cmd.exe mangles arguments containing XML tags,
  // pipes, quotes, etc. and has an ~8 KB command-line length limit.
  //
  // On macOS/Linux this avoids hitting the ~2 MB ARG_MAX execve limit on
  // very large diffs, and keeps the code path identical across platforms.
  if (prompt) {
    const tmpFile = path.join(os.tmpdir(), `gemini-prompt-${process.pid}-${Date.now()}.txt`);
    try {
      fs.writeFileSync(tmpFile, prompt, "utf8");

      // Build args without the prompt value
      const safeArgs = [...geminiArgs];

      if (isWin) {
        // Windows: shell redirection with -p " " as headless-mode switch
        safeArgs[pIdx + 1] = " ";
        const escapeForCmd = (s) => `"${String(s).replace(/"/g, '\\"')}"`;
        const cmd = `gemini ${safeArgs.map(escapeForCmd).join(" ")} < "${tmpFile.replace(/"/g, '')}"`;
        const result = spawnSync(cmd, [], {
          cwd: cwd ?? process.cwd(),
          encoding: "utf8",
          timeout,
          stdio: ["ignore", "pipe", "pipe"],
          shell: true,
        });
        return {
          status: result.status ?? 1,
          stdout: (result.stdout ?? "").trim(),
          stderr: (result.stderr ?? "").trim(),
          error: result.error?.message ?? null,
        };
      }

      // macOS/Linux: shell redirection without the escaping dance
      safeArgs[pIdx + 1] = " ";
      const cmd = `gemini ${safeArgs.map(a => `'${String(a).replace(/'/g, "'\\''")}'`).join(" ")} < '${tmpFile}'`;
      const result = spawnSync(cmd, [], {
        cwd: cwd ?? process.cwd(),
        encoding: "utf8",
        timeout,
        stdio: ["ignore", "pipe", "pipe"],
        shell: true,
      });
      return {
        status: result.status ?? 1,
        stdout: (result.stdout ?? "").trim(),
        stderr: (result.stderr ?? "").trim(),
        error: result.error?.message ?? null,
      };
    } finally {
      try { fs.unlinkSync(tmpFile); } catch { /* already cleaned */ }
    }
  }

  // No prompt — safe to pass args directly
  const result = spawnSync("gemini", geminiArgs, {
    cwd: cwd ?? process.cwd(),
    encoding: "utf8",
    timeout,
    stdio: ["ignore", "pipe", "pipe"],
    shell: isWin,
  });
  return {
    status: result.status ?? 1,
    stdout: (result.stdout ?? "").trim(),
    stderr: (result.stderr ?? "").trim(),
    error: result.error?.message ?? null,
  };
}

export function parseStructuredOutput(rawOutput, context = {}) {
  const text = String(rawOutput ?? "").trim();
  if (!text) return { parsed: null, parseError: context.failureMessage || "Empty output from Gemini", rawOutput: text };
  let jsonStr = text;
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) jsonStr = fenceMatch[1].trim();
  try {
    return { parsed: JSON.parse(jsonStr), parseError: null, rawOutput: text };
  } catch {
    return { parsed: null, parseError: "Failed to parse Gemini output as JSON", rawOutput: text };
  }
}
