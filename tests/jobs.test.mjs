// tests/jobs.test.mjs
// End-to-end behaviour of failures, background jobs, cancellation, session
// cleanup and the stop review gate, driven through a fake `agy` binary.
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { createTempDir, cleanTempDir, initGitRepo } from "./helpers.mjs";
import { installFakeAgy, fakeAgyEnv, readFakeAgyCalls } from "./fake-agy-fixture.mjs";
import { parseGateVerdict } from "../scripts/stop-review-gate-hook.mjs";
import { upsertJob, listJobs, MAX_STORED_JOBS } from "../scripts/lib/state.mjs";
import { isProcessAlive } from "../scripts/lib/process.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTS = path.resolve(__dirname, "..", "scripts");
const COMPANION = path.join(SCRIPTS, "gemini-companion.mjs");
const LIFECYCLE_HOOK = path.join(SCRIPTS, "session-lifecycle-hook.mjs");
const GATE_HOOK = path.join(SCRIPTS, "stop-review-gate-hook.mjs");

function run(script, args, { cwd, env, input = "" } = {}) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd, env: env ?? process.env, encoding: "utf8", timeout: 30000, input,
  });
}
const companion = (args, opts) => run(COMPANION, args, opts);
const json = (result) => JSON.parse(result.stdout.trim());

async function waitFor(predicate, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("waitFor timed out");
}

describe("failure propagation", () => {
  let tmp, binDir, env;
  beforeEach(() => { tmp = createTempDir(); binDir = path.join(tmp, "bin"); env = fakeAgyEnv(binDir); });
  afterEach(() => { cleanTempDir(tmp); });

  it("exits non-zero with the CLI's error when Gemini reports one", () => {
    installFakeAgy(binDir, "auth-error");
    const result = companion(["task", "--json", "do something"], { cwd: tmp, env });
    assert.equal(result.status, 1);
    assert.match(json(result).error, /authentication failed/);
    assert.match(json(result).error, /GEMINI_API_KEY/, "should say how to authenticate");
  });

  it("exits non-zero when agy rejects the model", () => {
    installFakeAgy(binDir, "unknown-model");
    const result = companion(["task", "--model", "nope", "x"], { cwd: tmp, env });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /not recognized as a known model/);
  });

  it("exits non-zero when the process dies without a result", () => {
    installFakeAgy(binDir, "crash");
    const result = companion(["task", "do something"], { cwd: tmp, env });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /agy exited with status 2: panic: something went wrong/);
    assert.equal(result.stdout.trim(), "");
  });

  it("setup reports the auth failure reason", () => {
    installFakeAgy(binDir, "auth-error");
    const report = json(companion(["setup", "--json"], { cwd: tmp, env }));
    assert.equal(report.agyAvailable, true);
    assert.equal(report.loggedIn, false);
    assert.match(report.detail, /not signed in/);
  });
});

describe("prompt delivery", () => {
  let tmp, binDir, env;
  beforeEach(() => {
    tmp = createTempDir(); binDir = path.join(tmp, "bin");
    installFakeAgy(binDir, "echo"); env = fakeAgyEnv(binDir);
  });
  afterEach(() => { cleanTempDir(tmp); });

  it("unwraps the result event and sends the prompt on stdin, not argv", () => {
    const tricky = "<role>x</role> | \"quoted\" $HOME\nsecond line";
    const result = companion(["task", "--json", "--model", "deep", "--effort", "h", tricky], { cwd: tmp, env });
    assert.equal(result.status, 0);
    const echoed = JSON.parse(json(result).output);
    assert.equal(echoed.promptHead, tricky);
    assert.ok(!echoed.args.some((a) => a.includes("quoted")), "prompt must not appear in argv");
    assert.ok(echoed.args.includes("--model=gemini-4-carbon"));
    assert.ok(echoed.args.includes("--effort=high"));
    assert.ok(echoed.args.join(" ").includes("--input-format stream-json --output-format stream-json"));
    assert.ok(echoed.args.includes("--print-timeout"));
  });

  it("handles prompts far larger than a single argv entry allows", () => {
    const promptFile = path.join(tmp, "big.txt");
    fs.writeFileSync(promptFile, "x".repeat(400 * 1024));
    const result = companion(["task", "--json", "--prompt-file", promptFile], { cwd: tmp, env });
    assert.equal(result.status, 0);
    assert.equal(JSON.parse(json(result).output).promptLength, 400 * 1024);
  });

  it("reports a malformed --model as a usage error, in the foreground and for background jobs", () => {
    const fg = companion(["task", "--model", "two words", "x"], { cwd: tmp, env });
    assert.equal(fg.status, 1);
    assert.match(fg.stderr, /Invalid model value/);
    assert.doesNotMatch(fg.stderr, /at .*\.mjs:\d+/, "no stack trace");
    const bg = companion(["task", "--background", "--json", "--model", "two words", "x"], { cwd: tmp, env });
    assert.equal(bg.status, 1);
    assert.match(JSON.parse(bg.stdout).error, /Invalid model value/);
    assert.equal(readFakeAgyCalls(binDir).length, 0);
    assert.equal(listJobs(tmp).length, 0, "no job record for a rejected request");
  });

  it("pins read-only settings unless --write is given", () => {
    companion(["task", "--json", "read only"], { cwd: tmp, env });
    companion(["task", "--json", "--write", "may edit"], { cwd: tmp, env });
    const [readOnly, write] = readFakeAgyCalls(binDir);
    assert.ok(!readOnly.args.includes("--dangerously-skip-permissions"));
    const settingsArg = readOnly.args.find((a) => a.startsWith("--settings="));
    const settings = JSON.parse(fs.readFileSync(settingsArg.slice("--settings=".length), "utf8"));
    assert.deepEqual(settings, { agentMode: "", toolPermission: "request-review" });
    assert.ok(write.args.includes("--dangerously-skip-permissions"));
    assert.ok(!write.args.some((a) => a.startsWith("--settings")));
  });

  it("resumes the previous task conversation by id", () => {
    companion(["task", "--json", "first"], { cwd: tmp, env });
    assert.equal(json(companion(["task-resume-candidate", "--json"], { cwd: tmp, env })).resumable, true);
    companion(["task", "--json", "--resume-last", "second"], { cwd: tmp, env });
    const [, second] = readFakeAgyCalls(binDir);
    assert.ok(second.args.includes("--conversation=11111111-2222-3333-4444-555555555555"));
    assert.ok(!second.args.includes("--continue"));
  });

  it("passes extra directories as repeated --add-dir", () => {
    companion(["analyze", "--json", "--dirs", "../a, ../b", "map it"], { cwd: tmp, env });
    const [call] = readFakeAgyCalls(binDir);
    assert.deepEqual(call.args.filter((a) => a.startsWith("--add-dir")), ["--add-dir=../a", "--add-dir=../b"]);
  });
});

describe("review context", () => {
  let tmp, binDir, env;
  beforeEach(() => {
    tmp = createTempDir(); binDir = path.join(tmp, "bin"); initGitRepo(tmp);
    fs.writeFileSync(path.join(tmp, ".gitignore"), "bin/\n");
    spawnSync("git", ["add", ".gitignore"], { cwd: tmp });
    spawnSync("git", ["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-m", "ignore"], { cwd: tmp });
    installFakeAgy(binDir, "review-ok"); env = fakeAgyEnv(binDir);
  });
  afterEach(() => { cleanTempDir(tmp); });

  it("does not call agy when there is nothing to review", () => {
    const result = companion(["review", "--json"], { cwd: tmp, env });
    assert.equal(result.status, 0);
    assert.equal(json(result).skipped, true);
    assert.equal(readFakeAgyCalls(binDir).length, 0);
  });

  it("includes the contents of new untracked files", () => {
    fs.writeFileSync(path.join(tmp, "brand-new.js"), "export const UNIQUE_MARKER_42 = true;\n");
    const result = companion(["review", "--json"], { cwd: tmp, env });
    assert.equal(json(result).verdict, "approve");
    const [call] = readFakeAgyCalls(binDir);
    assert.match(call.prompt, /new file: brand-new\.js/);
    assert.match(call.prompt, /UNIQUE_MARKER_42/);
  });

  it("fails, instead of printing an empty review, when agy returns no text", () => {
    installFakeAgy(binDir, "empty-success");
    fs.writeFileSync(path.join(tmp, "a.js"), "x\n");
    const result = companion(["review"], { cwd: tmp, env });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /agy returned an empty review/);
  });

  it("fails clearly on an unknown --base ref", () => {
    const result = companion(["review", "--base", "no-such-ref"], { cwd: tmp, env });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Could not diff against "no-such-ref"/);
  });

  it("keeps plugin state out of git status", () => {
    companion(["setup", "--enable-review-gate", "--json"], { cwd: tmp, env });
    const status = spawnSync("git", ["status", "--porcelain"], { cwd: tmp, encoding: "utf8" }).stdout;
    assert.equal(status.trim(), "");
  });
});

describe("background jobs", () => {
  let tmp, binDir, env;
  beforeEach(() => { tmp = createTempDir(); binDir = path.join(tmp, "bin"); initGitRepo(tmp); env = fakeAgyEnv(binDir); });
  afterEach(() => { cleanTempDir(tmp); });

  const jobById = (id) => listJobs(tmp).find((j) => j.id === id);

  it("result --wait blocks until the job finishes, then prints its output", () => {
    installFakeAgy(binDir, "task-ok");
    const { jobId } = json(companion(["task", "--background", "--json", "investigate"], { cwd: tmp, env }));
    const result = companion(["result", jobId, "--wait"], { cwd: tmp, env });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /Task completed successfully/);
    assert.equal(jobById(jobId).status, "done");
  });

  it("says so when a finished task has no text, instead of a bare header", () => {
    installFakeAgy(binDir, "empty-success");
    const { jobId } = json(companion(["task", "--background", "--json", "investigate"], { cwd: tmp, env }));
    const result = companion(["result", jobId, "--wait"], { cwd: tmp, env });
    assert.match(result.stdout, /agy returned no text/);
  });

  it("runs a task to completion and serves its output", async () => {
    installFakeAgy(binDir, "task-ok");
    const { jobId } = json(companion(["task", "--background", "--json", "investigate"], { cwd: tmp, env }));
    await waitFor(() => jobById(jobId)?.status === "done");
    const result = json(companion(["result", "--json", jobId], { cwd: tmp, env }));
    assert.equal(result.output, "Task completed successfully. Modified 2 files.");
    // The full prompt/output must not be stored in the shared state file.
    assert.equal(jobById(jobId).output, undefined);
    assert.equal(jobById(jobId).prompt, undefined);
    assert.equal(jobById(jobId).promptPreview, "investigate");
  });

  it("renders a background review as a review, not raw JSON", async () => {
    installFakeAgy(binDir, "review-findings");
    fs.writeFileSync(path.join(tmp, "a.js"), "let a;\n");
    const { jobId } = json(companion(["review", "--background", "--json"], { cwd: tmp, env }));
    await waitFor(() => jobById(jobId)?.status === "done");
    const result = companion(["result", jobId], { cwd: tmp, env });
    assert.match(result.stdout, /\*\*Verdict:\*\*/);
    assert.match(result.stdout, /\[HIGH\] Missing null check/);
  });

  it("marks the job as failed when agy fails", async () => {
    installFakeAgy(binDir, "auth-error");
    const { jobId } = json(companion(["task", "--background", "--json", "x"], { cwd: tmp, env }));
    await waitFor(() => jobById(jobId)?.status === "error");
    assert.match(jobById(jobId).error, /authentication failed/);
    const result = json(companion(["result", "--json", jobId], { cwd: tmp, env }));
    assert.equal(result.status, "error");
  });

  it("cancel terminates the worker process", async () => {
    installFakeAgy(binDir, "slow");
    const { jobId } = json(companion(["task", "--background", "--json", "x"], { cwd: tmp, env }));
    await waitFor(() => readFakeAgyCalls(binDir).length > 0);
    const pid = jobById(jobId).pid;
    assert.ok(isProcessAlive(pid), "worker should be running");
    const cancelled = json(companion(["cancel", "--json", jobId], { cwd: tmp, env }));
    assert.equal(cancelled.status, "cancelled");
    await waitFor(() => !isProcessAlive(pid));
    assert.equal(jobById(jobId).status, "cancelled");
  });

  it("SessionEnd cancels only the ending session's jobs", async () => {
    installFakeAgy(binDir, "slow");
    const start = (session) => json(companion(["task", "--background", "--json", "x"],
      { cwd: tmp, env: { ...env, GEMINI_COMPANION_SESSION_ID: session } })).jobId;
    const mine = start("session-a");
    const other = start("session-b");
    await waitFor(() => readFakeAgyCalls(binDir).length === 2);
    run(LIFECYCLE_HOOK, ["SessionEnd"], { cwd: tmp, env, input: JSON.stringify({ session_id: "session-a" }) });
    await waitFor(() => !isProcessAlive(jobById(mine).pid));
    assert.equal(jobById(mine).status, "cancelled");
    assert.equal(jobById(other).status, "running");
    companion(["cancel", other], { cwd: tmp, env });
  });

  it("reports a job whose worker died as failed instead of running forever", () => {
    upsertJob(tmp, { id: "task-dead", class: "task", status: "running", pid: 2 ** 22 + 12345, startedAt: new Date(Date.now() - 60000).toISOString() });
    const { jobs } = json(companion(["status", "--json"], { cwd: tmp, env }));
    assert.equal(jobs[0].status, "error");
  });
});

describe("job ID prefix matching", () => {
  let tmp;
  beforeEach(() => {
    tmp = createTempDir();
    upsertJob(tmp, { id: "task-aaa", class: "task", status: "done", completedAt: new Date().toISOString() });
    upsertJob(tmp, { id: "task-bbb", class: "task", status: "done", completedAt: new Date().toISOString() });
  });
  afterEach(() => { cleanTempDir(tmp); });

  it("rejects an ambiguous prefix instead of picking the oldest job", () => {
    for (const cmd of ["status", "result", "cancel"]) {
      const result = companion([cmd, "--json", "task"], { cwd: tmp });
      assert.equal(result.status, 1, cmd);
      assert.equal(json(result).error, 'Ambiguous job ID "task" matches: task-aaa, task-bbb', cmd);
    }
  });

  it("still resolves a unique prefix", () => {
    const { job } = json(companion(["status", "--json", "task-b"], { cwd: tmp }));
    assert.equal(job.id, "task-bbb");
  });
});

describe("job retention", () => {
  let tmp;
  beforeEach(() => { tmp = createTempDir(); });
  afterEach(() => { cleanTempDir(tmp); });

  it("prunes the oldest finished jobs but never running ones", () => {
    upsertJob(tmp, { id: "keep-running", status: "running" });
    for (let i = 0; i < MAX_STORED_JOBS + 5; i++) upsertJob(tmp, { id: `job-${i}`, status: "done" });
    const jobs = listJobs(tmp);
    assert.equal(jobs.length, MAX_STORED_JOBS);
    assert.ok(jobs.some((j) => j.id === "keep-running"));
    assert.ok(!jobs.some((j) => j.id === "job-0"));
  });
});

describe("session start hook", () => {
  let tmp;
  beforeEach(() => { tmp = createTempDir(); });
  afterEach(() => { cleanTempDir(tmp); });

  it("exports the session id through CLAUDE_ENV_FILE and leaves unused workspaces untouched", () => {
    const envFile = path.join(tmp, "env.sh");
    const result = run(LIFECYCLE_HOOK, ["SessionStart"], {
      cwd: tmp, env: { ...process.env, CLAUDE_ENV_FILE: envFile }, input: JSON.stringify({ session_id: "abc-123" }),
    });
    assert.equal(result.status, 0);
    assert.equal(fs.readFileSync(envFile, "utf8"), "export GEMINI_COMPANION_SESSION_ID='abc-123'\n");
    assert.ok(!fs.existsSync(path.join(tmp, ".gemini-tasks")));
  });

  it("refuses to write a session id that is not shell-safe", () => {
    const envFile = path.join(tmp, "env.sh");
    run(LIFECYCLE_HOOK, ["SessionStart"], {
      cwd: tmp, env: { ...process.env, CLAUDE_ENV_FILE: envFile }, input: JSON.stringify({ session_id: "x'; rm -rf ~ #" }),
    });
    assert.ok(!fs.existsSync(envFile));
  });
});

describe("parseGateVerdict", () => {
  it("parses ALLOW", () => assert.deepEqual(parseGateVerdict("ALLOW: fine"), { decision: "allow", reason: "fine" }));
  it("parses BLOCK", () => assert.deepEqual(parseGateVerdict("BLOCK: missing test"), { decision: "block", reason: "missing test" }));
  it("tolerates leading blank lines and markdown", () => {
    assert.deepEqual(parseGateVerdict("\n**BLOCK:** broken retry\nmore"), { decision: "block", reason: "broken retry" });
  });
  it("uses the first verdict line", () => assert.equal(parseGateVerdict("ALLOW: ok\nBLOCK: no").decision, "allow"));
  it("ignores BLOCK mid-sentence", () => assert.equal(parseGateVerdict("I would not BLOCK: this"), null));
  it("returns null without a verdict", () => assert.equal(parseGateVerdict("no verdict here"), null));
});

describe("stop review gate hook", () => {
  let tmp, binDir, env;
  beforeEach(() => {
    tmp = createTempDir(); binDir = path.join(tmp, "bin"); initGitRepo(tmp);
    fs.writeFileSync(path.join(tmp, ".gitignore"), "bin/\n");
    spawnSync("git", ["add", ".gitignore"], { cwd: tmp });
    spawnSync("git", ["-c", "user.name=T", "-c", "user.email=t@t", "commit", "-m", "ignore"], { cwd: tmp });
    installFakeAgy(binDir, "gate-block"); env = fakeAgyEnv(binDir);
  });
  afterEach(() => { cleanTempDir(tmp); });

  const gate = (input = {}) => run(GATE_HOOK, [], { cwd: tmp, env, input: JSON.stringify({ last_assistant_message: "Edited a.js", ...input }) });
  const enable = () => companion(["setup", "--enable-review-gate", "--json"], { cwd: tmp, env });
  const gateCalls = () => readFakeAgyCalls(binDir).filter((c) => c.prompt.includes("stop-gate review"));
  const dirty = (content = "let a;\n") => fs.writeFileSync(path.join(tmp, "a.js"), content);

  it("does nothing when disabled", () => {
    dirty();
    const result = gate();
    assert.equal(result.status, 0);
    assert.equal(result.stdout.trim(), "");
    assert.equal(gateCalls().length, 0);
  });

  it("does nothing when the working tree is clean", () => {
    enable();
    assert.equal(gate().stdout.trim(), "");
    assert.equal(gateCalls().length, 0);
  });

  it("blocks when Gemini says BLOCK", () => {
    enable(); dirty();
    const decision = JSON.parse(gate().stdout.trim());
    assert.equal(decision.decision, "block");
    assert.match(decision.reason, /Missing error handling/);
  });

  it("never re-fires while a stop hook is already active", () => {
    enable(); dirty();
    assert.equal(gate({ stop_hook_active: true }).stdout.trim(), "");
    assert.equal(gateCalls().length, 0);
  });

  it("reviews a given set of changes only once", () => {
    enable(); dirty();
    gate();
    assert.equal(gate().stdout.trim(), "", "unchanged tree must not be re-reviewed");
    assert.equal(gateCalls().length, 1);
    dirty("let b;\n");
    gate();
    assert.equal(gateCalls().length, 2);
  });

  it("fails open with a visible warning when Gemini is broken", () => {
    enable(); dirty();
    installFakeAgy(binDir, "auth-error");
    const payload = JSON.parse(gate().stdout.trim());
    assert.equal(payload.decision, undefined);
    assert.match(payload.systemMessage, /review gate skipped/);
  });
});
