// tests/fake-agy-fixture.mjs
// A stand-in for the Antigravity CLI (`agy`) that speaks its headless
// stream-json protocol: one `user` event on stdin, `init` + `result` events
// on stdout. Modelled on agy 1.5.9.
import fs from "node:fs";
import path from "node:path";

const REVIEW_OK = JSON.stringify({ verdict: "approve", summary: "Code looks good.", findings: [], next_steps: [] });
const REVIEW_FINDINGS = JSON.stringify({
  verdict: "needs-attention",
  summary: "Issues found.",
  findings: [{
    severity: "high", title: "Missing null check", body: "Variable could be null at line 42.",
    file: "src/main.js", line_start: 42, line_end: 42, confidence: 0.9,
    recommendation: "Add a null check before accessing the property.",
  }],
  next_steps: ["Fix the null check"],
});

/**
 * `response` → SUCCESS result. `error` → ERROR result, exit 1 (as agy does).
 * `permissionMode` → the init event's permission_mode (default "request-review").
 * `noInit` → omit the init event.
 * `emptyResult` → stream the text as deltas but leave the result's response empty.
 * `modelsSignedOut` → `agy models` prints agy's sign-in error instead of a list.
 */
const BEHAVIORS = {
  "review-ok": { response: REVIEW_OK },
  "review-findings": { response: "```json\n" + REVIEW_FINDINGS + "\n```" },
  "task-ok": { response: "Task completed successfully. Modified 2 files." },
  "gate-allow": { response: "ALLOW: No blocking issues found." },
  "gate-block": { response: "BLOCK: Missing error handling in auth module." },
  "auth-ok": { response: "OK" },
  "auth-ok-punctuated": { response: "**Ok.**" },
  // What agy 1.5.9 prints when not signed in and stdin is a pipe.
  "auth-error": {
    error: "authentication failed or timed out",
    stderr: "Error: authentication required. Run 'agy' to log in, then retry.",
    modelsSignedOut: true,
  },
  // Signed in but the probe/run fails for a non-auth reason.
  "quota-error": { error: "RESOURCE_EXHAUSTED: quota exceeded for model gemini-4-argon" },
  // Signed in, but the model does not follow the probe instruction exactly.
  "chatty": { response: "OK, sure! What would you like me to do next?" },
  // agy ignored the read-only overlay and ran in Auto mode.
  "auto-mode": { response: "Task completed.", permissionMode: "auto" },
  // SUCCESS result but no init event, so the permission mode is unknown.
  "no-init": { response: "Task completed.", noInit: true },
  // Text only in step_update deltas; the result event's response is empty.
  "deltas-only": { response: "Answer from deltas.", emptyResult: true },
  // SUCCESS with no text at all.
  "empty-success": { response: "" },
  // Exits 0 with only noise on stdout and a reason on stderr.
  "no-result": { stdout: "not json", stderr: "warning: stream closed early", exitCode: 0, noResult: true },
  "unknown-model": { error: "invalid model selection (--model \"nope\" --effort \"\"): model nope is not recognized as a known model" },
  // Dies without printing a result envelope at all.
  "crash": { stderr: "panic: something went wrong", exitCode: 2, noResult: true },
  // Echoes what it received so tests can assert on argv and the prompt.
  "echo": { echo: true },
  // Hangs until killed — for cancel / session-end tests. Honours
  // --print-timeout like real agy: if it is shorter than sleepMs, prints
  // "AGY_ERROR: print timeout" on stderr and exits 3 when it expires.
  "slow": { sleepMs: 60000, response: "finally done" },
};

/**
 * Install a fake `agy` executable into binDir. Every headless run is appended
 * to `<binDir>/calls.log` as one JSON line: { args, prompt }. `--version` and
 * `agy models` calls are not logged.
 */
export function installFakeAgy(binDir, behavior = "task-ok") {
  fs.mkdirSync(binDir, { recursive: true });
  const spec = BEHAVIORS[behavior];
  if (!spec) throw new Error(`Unknown fake agy behavior: ${behavior}`);
  const callsLog = path.join(binDir, "calls.log");

  const script = `#!/usr/bin/env node
const fs = require("node:fs");
const spec = ${JSON.stringify(spec)};
const args = process.argv.slice(2);
if (args.includes("--version")) { console.log("1.5.9"); process.exit(0); }
if (args[0] === "models") {
  // Real agy 1.5.9 prints the sign-in error on stderr and exits 1.
  if (spec.modelsSignedOut) {
    process.stderr.write("Fetching available models...\\nError: Please sign in to view available models. Launch the CLI without arguments to sign in.\\n");
    process.exit(1);
  }
  console.log("gemini-4-argon\\ngemini-4-carbon\\ngemini-4-hydrogen\\ngemini-3.8-flash");
  process.exit(0);
}
/** Seconds from --print-timeout=<n>s / --print-timeout <n>s, or null. */
function printTimeoutSeconds() {
  for (let i = 0; i < args.length; i++) {
    let v = null;
    if (args[i].startsWith("--print-timeout=")) v = args[i].slice("--print-timeout=".length);
    else if (args[i] === "--print-timeout") v = args[i + 1];
    if (v != null) { const n = parseFloat(v); return Number.isFinite(n) ? n : null; }
  }
  return null;
}
let prompt = "";
try {
  for (const line of fs.readFileSync(0, "utf8").split("\\n")) {
    if (!line.trim()) continue;
    const msg = JSON.parse(line);
    if (msg.event === "user") prompt = typeof msg.message.content === "string" ? msg.message.content : msg.message.content.map((b) => b.text).join("");
  }
} catch {}
fs.appendFileSync(${JSON.stringify(callsLog)}, JSON.stringify({ args, prompt }) + "\\n");
const id = "11111111-2222-3333-4444-555555555555";
const usage = { input_tokens: 1, output_tokens: 1, thinking_tokens: 0, cache_read_tokens: 0, total_tokens: 2 };
function finish() {
  if (spec.stderr) process.stderr.write(spec.stderr + "\\n");
  if (spec.noResult) process.exit(spec.exitCode ?? 1);
  if (spec.error) {
    console.log(JSON.stringify({ event: "result", result: { conversation_id: "", status: "ERROR", response: "", error: spec.error, duration_seconds: 0, num_turns: 0, usage, finished_reason: "error" } }));
    process.exit(1);
  }
  const response = spec.echo ? JSON.stringify({ args, promptLength: prompt.length, promptHead: prompt.slice(0, 200) }) : spec.response;
  if (!spec.noInit) console.log(JSON.stringify({ event: "init", conversation_id: id, init: { cwd: process.cwd(), tools: [], permission_mode: spec.permissionMode ?? "request-review" } }));
  console.log(JSON.stringify({ event: "step_update", step_update: { conversation_id: id, step_index: 1, state: "DONE", step_type: "agent_response", text_delta: response } }));
  console.log(JSON.stringify({ event: "result", result: { conversation_id: id, status: "SUCCESS", response: spec.emptyResult ? "" : response + "\\n", duration_seconds: 0.1, num_turns: 1, usage } }));
  process.exit(0);
}
if (spec.sleepMs) {
  const limit = printTimeoutSeconds();
  if (limit != null && limit * 1000 < spec.sleepMs) {
    setTimeout(() => { process.stderr.write("AGY_ERROR: print timeout\\n"); process.exit(3); }, limit * 1000);
  } else setTimeout(finish, spec.sleepMs);
} else finish();
`;
  fs.writeFileSync(path.join(binDir, "agy"), script, { mode: 0o755 });
}

/** Parsed runs of the fake agy, excluding `--version` probes. */
export function readFakeAgyCalls(binDir) {
  try {
    return fs.readFileSync(path.join(binDir, "calls.log"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch { return []; }
}

/** PATH with binDir prepended, so the fake agy is found first. */
export function fakeAgyEnv(binDir) {
  return { ...process.env, PATH: binDir + path.delimiter + process.env.PATH, ...fakeAgyCommand(binDir) };
}

/**
 * Windows cannot run the fake (a `#!` script) by name without a shell, so
 * there it is run through node via GEMINI_AGY_COMMAND. Elsewhere the real
 * PATH lookup is used.
 * @param {string} binDir
 */
export function fakeAgyCommand(binDir) {
  return process.platform === "win32" ? { GEMINI_AGY_COMMAND: JSON.stringify([process.execPath, path.join(binDir, "agy")]) } : {};
}
