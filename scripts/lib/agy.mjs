// scripts/lib/agy.mjs
// Wrapper around the Antigravity CLI (`agy`), Google's terminal agent for
// Gemini models. Contract: https://antigravity.google/docs/cli/headless/
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { binaryAvailable } from "./process.mjs";

const PLUGIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const READ_ONLY_SETTINGS = path.join(PLUGIN_ROOT, "config", "read-only.settings.json");

export const INSTALL_HINT = process.platform === "win32"
  ? "irm https://antigravity.google/cli/install.ps1 | iex"
  : "curl -fsSL https://antigravity.google/cli/install.sh | bash";
export const AUTH_HINT = "run `agy` once interactively to sign in, or set `GEMINI_API_KEY`";

/**
 * Short names for base model slugs. `agy` accepts a base name and picks the
 * model's default thinking level unless `--effort` is given. `pro` and `flash`
 * follow what agy itself uses for its `pro` / `flash` subagents. Anything not
 * listed is passed through unchanged — run `agy models` for the full list.
 */
const MODEL_ALIASES = new Map([
  ["argon", "gemini-4-argon"], ["pro", "gemini-4-argon"],
  ["carbon", "gemini-4-carbon"], ["deep", "gemini-4-carbon"],
  ["hydrogen", "gemini-4-hydrogen"],
  ["flash", "gemini-3.8-flash"], ["fast", "gemini-3.8-flash"],
  ["lite", "gemini-3.8-flash"], ["flash-lite", "gemini-3.8-flash"],
]);

const EFFORT_ALIASES = new Map([
  ["low", "low"], ["l", "low"],
  ["medium", "medium"], ["med", "medium"], ["m", "medium"],
  ["high", "high"], ["h", "high"],
  ["xhigh", "xhigh"], ["xh", "xhigh"],
  ["max", "max"],
]);

const MAX_BUFFER = 64 * 1024 * 1024;

/**
 * The command that runs agy: `agy` on PATH, or GEMINI_AGY_COMMAND as a JSON
 * array (e.g. ["node", "/path/fake-agy"]). The tests need this on Windows,
 * which cannot run a script by name without a shell.
 * @returns {[string, ...string[]]}
 */
export function agyCommand(env = process.env) {
  if (!env.GEMINI_AGY_COMMAND) return ["agy"];
  const cmd = JSON.parse(env.GEMINI_AGY_COMMAND);
  if (!Array.isArray(cmd) || cmd.length === 0 || !cmd.every((p) => typeof p === "string" && p)) {
    throw new Error("GEMINI_AGY_COMMAND must be a JSON array of non-empty strings");
  }
  return /** @type {[string, ...string[]]} */ (cmd);
}

/** @param {string | null | undefined} alias */
export function resolveModelAlias(alias) {
  if (alias == null) return null;
  const n = String(alias).trim().toLowerCase();
  if (!n) return null;
  return MODEL_ALIASES.get(n) ?? String(alias).trim();
}

/**
 * Normalise an effort level. Which levels a model supports varies (agy
 * rejects unsupported ones loudly), so unknown values are passed through.
 * @param {string | null | undefined} effort
 */
export function resolveEffort(effort) {
  if (effort == null) return null;
  const n = String(effort).trim().toLowerCase();
  if (!n) return null;
  return EFFORT_ALIASES.get(n) ?? n;
}

/**
 * `--name=value` with a user-supplied value. The `=` form means a value can
 * never be parsed as another flag (agy uses Go's flag package, which accepts
 * it). Values that are single tokens by nature reject whitespace outright.
 * @param {string} name
 * @param {string} value
 */
function tokenFlag(name, value) {
  if (/\s/.test(value)) throw new Error(`Invalid ${name} value ${JSON.stringify(value)}: must not contain whitespace`);
  return `--${name}=${value}`;
}

/** @param {string | null | undefined} alias */
export function buildModelFlag(alias) {
  const resolved = resolveModelAlias(alias);
  return resolved ? [tokenFlag("model", resolved)] : [];
}

/** @param {string | null | undefined} effort */
export function buildEffortFlag(effort) {
  const resolved = resolveEffort(effort);
  return resolved ? [tokenFlag("effort", resolved)] : [];
}

/** @param {string} [cwd] */
export function getAgyAvailability(cwd) {
  const [bin, ...pre] = agyCommand();
  return binaryAvailable(bin, [...pre, "--version"], { cwd });
}

export const AUTH_ERROR_RE = /authenticat|sign(ed)?[ -]in|log(ged)?[ -]in/i;
const LOGIN_PROBE_PROMPT = "Reply with exactly: OK";

/**
 * Check that agy can actually reach a model.
 *
 * Cheap pre-check first: `agy models` makes no model call and, when signed
 * out, prints "Please sign in to view available models" (agy 1.5.9 prints it
 * on stderr and exits 1). It is skipped when GEMINI_API_KEY is set, since an
 * API key may serve model calls without an account sign-in. Then one live
 * probe whose reply must be exactly "OK" (case and punctuation aside).
 * A failure is only called an authentication problem when agy says so;
 * quota, network or model errors are reported as they are.
 *
 * @param {string} [cwd]
 * @returns {{ available: boolean, loggedIn: boolean, detail: string | null }}
 */
export function getAgyLoginStatus(cwd) {
  const avail = getAgyAvailability(cwd);
  if (!avail.available) return { available: false, loggedIn: false, detail: "Antigravity CLI (agy) not installed" };

  if (!process.env.GEMINI_API_KEY) {
    const [bin, ...pre] = agyCommand();
    const models = spawnSync(bin, [...pre, "models"], {
      cwd: cwd ?? process.cwd(), encoding: "utf8", timeout: 15000,
      stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
    });
    const text = `${models.stdout ?? ""}\n${models.stderr ?? ""}`;
    if (/sign in/i.test(text)) {
      return { available: true, loggedIn: false, detail: `agy is not signed in — ${AUTH_HINT}` };
    }
  }

  const result = runAgy(buildAgyArgs({}), { cwd, prompt: LOGIN_PROBE_PROMPT, timeout: 60000 });
  if (result.ok && /^\W*ok\W*$/i.test(result.response)) return { available: true, loggedIn: true, detail: null };
  if (!result.ok) {
    const error = result.error ?? "agy run failed";
    return {
      available: true,
      loggedIn: false,
      detail: AUTH_ERROR_RE.test(error) ? error : `agy test prompt failed (not an authentication error): ${error}`,
    };
  }
  const reply = result.response.replace(/\s+/g, " ").slice(0, 80);
  return {
    available: true,
    loggedIn: false,
    detail: `agy answered the test prompt unexpectedly (expected "OK", got ${JSON.stringify(reply)})`,
  };
}

/**
 * Build agy flags for one headless run. The prompt is not part of argv — it
 * is passed to runAgy and delivered on stdin.
 *
 * Permissions: since agy 1.5.7 headless runs default to Auto mode, which
 * edits workspace files without asking. Unless `write` is set, a per-run
 * settings overlay (config/read-only.settings.json) pins the run to default
 * mode — both keys are documented agy settings: `agentMode: ""` selects the
 * default agent mode and `toolPermission: "request-review"` makes edits and
 * commands need an approval that headless runs cannot give (soft-denied).
 * runAgy double-checks the permission mode agy reports in its `init` event
 * and fails the run if the overlay was not honoured — that is the safety net.
 *
 * Values that come from users use the `--flag=value` form so they can never
 * be parsed as flags; model / effort / conversation values with whitespace
 * throw.
 *
 * @param {{ dirs?: string | null, model?: string | null, effort?: string | null, write?: boolean,
 *           conversationId?: string | null }} options
 * @returns {string[]}
 */
export function buildAgyArgs(options) {
  const args = [];
  for (const dir of String(options.dirs ?? "").split(",").map((d) => d.trim()).filter(Boolean)) {
    args.push(`--add-dir=${dir}`);
  }
  args.push(...buildModelFlag(options.model));
  args.push(...buildEffortFlag(options.effort));
  if (options.write) args.push("--dangerously-skip-permissions");
  else args.push(`--settings=${READ_ONLY_SETTINGS}`);
  if (options.conversationId != null && options.conversationId !== "") {
    args.push(tokenFlag("conversation", String(options.conversationId)));
  }
  args.push("--input-format", "stream-json", "--output-format", "stream-json");
  return args;
}

/**
 * Extract the terminal result from agy stream-json stdout: the last
 * `{"event":"result","result":{...}}` line. Only that shape counts — any other
 * JSON (including a bare `{status,response}` object) is ignored. The `init`
 * event's `permission_mode` is reported as `permissionMode`.
 * @param {string} stdout
 * @returns {{ found: boolean, status: string | null, response: string, error: string | null,
 *             conversationId: string | null, usage: unknown, permissionMode: string | null }}
 */
export function parseAgyOutput(stdout) {
  /** @type {Record<string, any> | null} */
  let envelope = null;
  /** @type {string | null} */
  let permissionMode = null;
  // Text of the last agent_response step, built from its text_deltas: the
  // fallback when the result event's `response` is empty.
  let stepIndex = -1, stepText = "";
  for (const line of String(stdout ?? "").split(/\r?\n/)) {
    const text = line.trim();
    if (!text.startsWith("{")) continue;
    try {
      const obj = JSON.parse(text);
      if (obj?.event === "result" && obj.result && typeof obj.result === "object") envelope = obj.result;
      else if (obj?.event === "init" && typeof obj.init?.permission_mode === "string") permissionMode = obj.init.permission_mode;
      else if (obj?.event === "step_update" && obj.step_update?.step_type === "agent_response" && typeof obj.step_update.text_delta === "string") {
        const step = obj.step_update;
        if (step.step_index !== stepIndex) { stepIndex = step.step_index; stepText = ""; }
        stepText += step.text_delta;
      }
    } catch { /* not a JSON line */ }
  }
  if (!envelope) {
    return { found: false, status: null, response: "", error: null, conversationId: null, usage: null, permissionMode };
  }
  const status = typeof envelope.status === "string" ? envelope.status : null;
  let error = typeof envelope.error === "string" && envelope.error ? envelope.error.trim() : null;
  if (!error && status !== "SUCCESS") error = `agy run ended with status ${status ?? "(none)"}`;
  return {
    found: true,
    status,
    response: (typeof envelope.response === "string" && envelope.response.trim()) || stepText.trim(),
    error,
    conversationId: envelope.conversation_id || null,
    usage: envelope.usage ?? null,
    permissionMode,
  };
}

/** agy's exit code when --print-timeout expires. */
const AGY_TIMEOUT_EXIT = 3;
const READ_ONLY_PERMISSION_MODE = "request-review";

/**
 * Run agy headlessly with one prompt.
 *
 * The prompt is sent on stdin as a single stream-json `user` event, never on
 * the command line: no argv size limit for large diffs, no shell quoting.
 * agy is a native binary, so no shell is involved on any platform.
 *
 * Never throws. `ok` is false when the process failed, timed out, agy
 * reported a non-SUCCESS status (auth, quota, unknown model, ...), produced
 * no result event, or — for a read-only run — reported a permission mode
 * other than "request-review" or none at all (`readOnlyViolated`). `error` then carries a
 * human-readable reason. A SUCCESS result with no text is ok with
 * `empty: true`.
 *
 * @param {string[]} agyArgs
 * @param {{ cwd?: string, prompt: string, timeout?: number }} options
 */
export function runAgy(agyArgs, { cwd, prompt, timeout = 300000 }) {
  const seconds = Math.max(1, Math.round(timeout / 1000));
  const args = [...agyArgs, "--print-timeout", `${seconds}s`];
  const input = JSON.stringify({ event: "user", message: { content: prompt } }) + "\n";
  const readOnly = !agyArgs.includes("--dangerously-skip-permissions");

  const [bin, ...pre] = agyCommand();
  const result = spawnSync(bin, [...pre, ...args], {
    cwd: cwd ?? process.cwd(),
    encoding: "utf8",
    // agy enforces --print-timeout itself; this is the backstop if it hangs.
    timeout: timeout + 30000,
    maxBuffer: MAX_BUFFER,
    input,
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });

  const stdout = (result.stdout ?? "").trim();
  const stderr = (result.stderr ?? "").trim();
  const parsed = parseAgyOutput(stdout);
  const status = result.status ?? 1;
  const spawnCode = result.error ? /** @type {NodeJS.ErrnoException} */ (result.error).code : null;
  const timedOut = spawnCode === "ETIMEDOUT" || result.status === AGY_TIMEOUT_EXIT;
  const stderrLines = stderr.split(/\r?\n/).filter(Boolean);
  const stderrTail = stderrLines.slice(-5).join("\n");

  /** @type {string | null} */
  let error = null;
  if (timedOut) error = `agy timed out after ${seconds}s`;
  else if (parsed.error) error = parsed.error;
  else if (result.error) {
    if (spawnCode === "ENOENT") error = `Antigravity CLI (agy) not found on PATH — install with: ${INSTALL_HINT}`;
    else error = `Failed to run agy: ${result.error.message}`;
  } else if (status !== 0) {
    // Usage errors (exit 2) print the reason first, then the whole flag list.
    const detail = status === 2 ? stderrLines[0] : stderrTail;
    error = `agy exited with status ${status}${detail ? `: ${detail}` : ""}`;
  } else if (!parsed.found) {
    error = `agy produced no result event${stderrTail ? `: ${stderrTail}` : " (stderr was empty)"}`;
  }
  if (error && !timedOut && AUTH_ERROR_RE.test(`${error}\n${stderr}`) && !error.includes(AUTH_HINT)) {
    error = `${error} — ${AUTH_HINT}`;
  }

  let readOnlyViolated = false;
  if (readOnly && parsed.permissionMode && parsed.permissionMode !== READ_ONLY_PERMISSION_MODE) {
    readOnlyViolated = true;
    error = `agy did not honour read-only mode (permission_mode=${parsed.permissionMode}); files may have been modified — check \`git status\``;
  } else if (readOnly && !error && !parsed.permissionMode) {
    // Fail closed, but never mask an earlier real error (auth, timeout, ...).
    readOnlyViolated = true;
    error = "agy did not report its permission mode; read-only mode could not be verified — check `git status`";
  }

  return {
    ok: !error,
    status,
    response: parsed.response,
    error,
    conversationId: parsed.conversationId,
    usage: parsed.usage,
    stdout,
    stderr,
    timedOut,
    empty: !error && parsed.response === "",
    readOnlyViolated,
    permissionMode: parsed.permissionMode,
  };
}

/**
 * @param {string} rawOutput
 */
export function parseStructuredOutput(rawOutput) {
  const text = String(rawOutput ?? "").trim();
  if (!text) return { parsed: null, parseError: "Empty output from Gemini", rawOutput: text };
  const candidates = [text];
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) candidates.push(fenceMatch[1].trim());
  const first = text.indexOf("{");
  const last = text.lastIndexOf("}");
  if (first !== -1 && last > first) candidates.push(text.slice(first, last + 1));
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object") return { parsed, parseError: null, rawOutput: text };
    } catch { /* try next candidate */ }
  }
  return { parsed: null, parseError: "Failed to parse Gemini output as JSON", rawOutput: text };
}
