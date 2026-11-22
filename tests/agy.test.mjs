// tests/agy.test.mjs
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  resolveModelAlias, resolveEffort, buildModelFlag, buildEffortFlag, buildAgyArgs, parseAgyOutput, parseStructuredOutput,
  runAgy, getAgyLoginStatus, agyCommand, AUTH_HINT,
} from "../scripts/lib/agy.mjs";
import { installFakeAgy, readFakeAgyCalls, fakeAgyCommand } from "./fake-agy-fixture.mjs";
import { createTempDir, cleanTempDir } from "./helpers.mjs";

/**
 * Run fn with a fake agy of the given behavior first on PATH (and
 * GEMINI_API_KEY unset), restoring the environment afterwards.
 * @template T
 * @param {string} behavior
 * @param {(binDir: string) => T} fn
 * @returns {T}
 */
function withFakeAgy(behavior, fn) {
  const binDir = createTempDir();
  installFakeAgy(binDir, behavior);
  const savedPath = process.env.PATH;
  const savedKey = process.env.GEMINI_API_KEY;
  const savedCmd = process.env.GEMINI_AGY_COMMAND;
  process.env.PATH = binDir + path.delimiter + savedPath;
  Object.assign(process.env, fakeAgyCommand(binDir));
  delete process.env.GEMINI_API_KEY;
  try {
    return fn(binDir);
  } finally {
    process.env.PATH = savedPath;
    if (savedKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = savedKey;
    if (savedCmd === undefined) delete process.env.GEMINI_AGY_COMMAND; else process.env.GEMINI_AGY_COMMAND = savedCmd;
    cleanTempDir(binDir);
  }
}

describe("resolveModelAlias", () => {
  it("resolves Gemini 4 element names", () => {
    assert.equal(resolveModelAlias("argon"), "gemini-4-argon");
    assert.equal(resolveModelAlias("carbon"), "gemini-4-carbon");
    assert.equal(resolveModelAlias("Hydrogen"), "gemini-4-hydrogen");
  });
  it("maps pro to Argon and deep to Carbon", () => {
    assert.equal(resolveModelAlias("pro"), "gemini-4-argon");
    assert.equal(resolveModelAlias("deep"), "gemini-4-carbon");
  });
  it("maps flash, fast and lite to the current Flash model", () => {
    for (const alias of ["flash", "fast", "lite", "flash-lite"]) assert.equal(resolveModelAlias(alias), "gemini-3.8-flash");
  });
  it("is case-insensitive and trims", () => assert.equal(resolveModelAlias(" PRO "), "gemini-4-argon"));
  it("passes through full slugs", () => assert.equal(resolveModelAlias("gemini-4-argon-high"), "gemini-4-argon-high"));
  it("returns null for null", () => assert.equal(resolveModelAlias(null), null));
  it("returns null for empty", () => assert.equal(resolveModelAlias(""), null));
});

describe("resolveEffort", () => {
  it("maps short forms", () => {
    assert.equal(resolveEffort("l"), "low");
    assert.equal(resolveEffort("med"), "medium");
    assert.equal(resolveEffort("h"), "high");
    assert.equal(resolveEffort("xh"), "xhigh");
  });
  it("keeps xhigh and max distinct", () => {
    assert.equal(resolveEffort("xhigh"), "xhigh");
    assert.equal(resolveEffort("max"), "max");
  });
  it("passes unknown values through for agy to judge", () => assert.equal(resolveEffort("turbo"), "turbo"));
  it("returns null for null and empty", () => {
    assert.equal(resolveEffort(null), null);
    assert.equal(resolveEffort(" "), null);
  });
});

describe("flags", () => {
  it("builds a model flag", () => assert.deepEqual(buildModelFlag("argon"), ["--model=gemini-4-argon"]));
  it("omits the model flag when unset", () => assert.deepEqual(buildModelFlag(null), []));
  it("builds an effort flag", () => assert.deepEqual(buildEffortFlag("high"), ["--effort=high"]));
  it("omits the effort flag when unset", () => assert.deepEqual(buildEffortFlag(null), []));
});

describe("buildAgyArgs", () => {
  const tail = ["--input-format", "stream-json", "--output-format", "stream-json"];

  it("is read-only by default", () => {
    const args = buildAgyArgs({});
    assert.match(args[0], /^--settings=.*read-only\.settings\.json$/);
    assert.ok(fs.existsSync(args[0].slice("--settings=".length)));
    assert.deepEqual(args.slice(1), tail);
  });
  it("skips permissions only in write mode", () => {
    assert.deepEqual(buildAgyArgs({ write: true }), ["--dangerously-skip-permissions", ...tail]);
  });
  it("splits dirs into repeated --add-dir=, dropping empty entries", () => {
    assert.deepEqual(buildAgyArgs({ dirs: "a, ,b,,", write: true }).slice(0, 3), ["--add-dir=a", "--add-dir=b", "--dangerously-skip-permissions"]);
  });
  it("keeps dir values that look like flags inside the = form", () => {
    const args = buildAgyArgs({ dirs: "--dangerously-skip-permissions" });
    assert.equal(args[0], "--add-dir=--dangerously-skip-permissions");
    assert.ok(!args.includes("--dangerously-skip-permissions"));
  });
  it("allows spaces in dir paths", () => {
    assert.equal(buildAgyArgs({ dirs: "my dir" })[0], "--add-dir=my dir");
  });
  it("uses the = form for model, effort and conversation", () => {
    const args = buildAgyArgs({ model: "pro", effort: "h", conversationId: "abc-123", write: true });
    assert.deepEqual(args, ["--model=gemini-4-argon", "--effort=high", "--dangerously-skip-permissions", "--conversation=abc-123", ...tail]);
  });
  it("keeps a flag-like model value attached to --model=", () => {
    assert.equal(buildAgyArgs({ model: "--dangerously-skip-permissions" })[0], "--model=--dangerously-skip-permissions");
  });
  it("rejects whitespace inside model, effort and conversation values", () => {
    assert.throws(() => buildAgyArgs({ model: "gemini 4" }), /model.*whitespace/);
    assert.throws(() => buildAgyArgs({ effort: "high\n--write" }), /effort.*whitespace/);
    assert.throws(() => buildAgyArgs({ conversationId: "abc --dangerously-skip-permissions" }), /conversation.*whitespace/);
    assert.throws(() => buildAgyArgs({ conversationId: " " }), /conversation.*whitespace/);
  });
  it("has no continue-latest option", () => {
    // @ts-ignore -- removed option must be ignored
    assert.ok(!buildAgyArgs({ continueLatest: true }).includes("--continue"));
  });
  it("never puts a prompt on the command line", () => assert.ok(!buildAgyArgs({}).includes("-p")));
});

describe("parseAgyOutput", () => {
  const result = (r) => JSON.stringify({ event: "result", result: r });

  it("reads the result event from a stream", () => {
    const out = parseAgyOutput([
      JSON.stringify({ event: "init", conversation_id: "c-1", init: {} }),
      JSON.stringify({ event: "step_update", step_update: { text_delta: "hel" } }),
      result({ conversation_id: "c-1", status: "SUCCESS", response: "hello\n", usage: { total_tokens: 5 } }),
    ].join("\n"));
    assert.equal(out.response, "hello");
    assert.equal(out.error, null);
    assert.equal(out.conversationId, "c-1");
    assert.deepEqual(out.usage, { total_tokens: 5 });
  });
  it("surfaces an ERROR result", () => {
    const out = parseAgyOutput(result({ conversation_id: "", status: "ERROR", response: "", error: "authentication failed or timed out" }));
    assert.equal(out.error, "authentication failed or timed out");
    assert.equal(out.conversationId, null);
  });
  it("treats a non-SUCCESS status without an error message as a failure", () => {
    assert.match(parseAgyOutput(result({ status: "INTERRUPTED", response: "partial" })).error, /INTERRUPTED/);
  });
  it("ignores a bare JSON envelope (only result events count)", () => {
    const out = parseAgyOutput(JSON.stringify({ conversation_id: "c", status: "SUCCESS", response: "hi" }));
    assert.equal(out.found, false);
    assert.equal(out.response, "");
    assert.equal(out.status, null);
  });
  it("exposes the init event's permission mode", () => {
    const out = parseAgyOutput([
      JSON.stringify({ event: "init", conversation_id: "c", init: { permission_mode: "request-review" } }),
      result({ status: "SUCCESS", response: "x" }),
    ].join("\n"));
    assert.equal(out.permissionMode, "request-review");
    assert.equal(parseAgyOutput(result({ status: "SUCCESS", response: "x" })).permissionMode, null);
  });
  it("treats SUCCESS with an empty response as a successful result", () => {
    const out = parseAgyOutput(result({ status: "SUCCESS", response: "" }));
    assert.equal(out.found, true);
    assert.equal(out.error, null);
    assert.equal(out.response, "");
  });
  it("ignores non-JSON noise lines", () => {
    assert.equal(parseAgyOutput("warning: something\n" + result({ status: "SUCCESS", response: "ok" })).response, "ok");
  });
  it("reports found: false when there is no result event", () => {
    const out = parseAgyOutput("plain text");
    assert.equal(out.found, false);
    assert.equal(out.status, null);
    assert.equal(out.error, null);
  });
  it("does not mistake a model's JSON answer inside the response for the envelope", () => {
    const review = JSON.stringify({ verdict: "approve", summary: "OK", findings: [] });
    assert.equal(parseAgyOutput(result({ status: "SUCCESS", response: review })).response, review);
  });
});

describe("agyCommand", () => {
  it("defaults to agy on PATH", () => assert.deepEqual(agyCommand({}), ["agy"]));
  it("parses GEMINI_AGY_COMMAND", () => assert.deepEqual(agyCommand({ GEMINI_AGY_COMMAND: '["node","/x/agy"]' }), ["node", "/x/agy"]));
  it("rejects a value that is not a list of strings", () => {
    assert.throws(() => agyCommand({ GEMINI_AGY_COMMAND: '"agy"' }), /JSON array/);
    assert.throws(() => agyCommand({ GEMINI_AGY_COMMAND: "[]" }), /JSON array/);
  });
  it("runs agy through GEMINI_AGY_COMMAND when agy is not on PATH", () => {
    const binDir = createTempDir();
    installFakeAgy(binDir, "task-ok");
    const saved = process.env.GEMINI_AGY_COMMAND;
    process.env.GEMINI_AGY_COMMAND = JSON.stringify([process.execPath, path.join(binDir, "agy")]);
    try {
      const r = runAgy(buildAgyArgs({}), { prompt: "x", timeout: 30000 });
      assert.equal(r.ok, true);
      assert.match(r.response, /Task completed/);
    } finally {
      if (saved === undefined) delete process.env.GEMINI_AGY_COMMAND; else process.env.GEMINI_AGY_COMMAND = saved;
      cleanTempDir(binDir);
    }
  });
});

describe("runAgy (fake agy)", () => {
  it("returns the response and conversation of a successful run", () => withFakeAgy("task-ok", (bin) => {
    const r = runAgy(buildAgyArgs({}), { prompt: "do it", timeout: 30000 });
    assert.equal(r.ok, true);
    assert.equal(r.response, "Task completed successfully. Modified 2 files.");
    assert.equal(r.conversationId, "11111111-2222-3333-4444-555555555555");
    assert.equal(r.permissionMode, "request-review");
    assert.deepEqual([r.timedOut, r.empty, r.readOnlyViolated], [false, false, false]);
    const [call] = readFakeAgyCalls(bin);
    assert.equal(call.prompt, "do it");
    assert.deepEqual(call.args.slice(-2), ["--print-timeout", "30s"]);
  }));
  it("treats SUCCESS with empty text as ok and empty", () => withFakeAgy("empty-success", () => {
    const r = runAgy(buildAgyArgs({}), { prompt: "x", timeout: 30000 });
    assert.equal(r.ok, true);
    assert.equal(r.empty, true);
    assert.equal(r.response, "");
    assert.equal(r.error, null);
  }));
  it("falls back to the streamed text when the result response is empty", () => withFakeAgy("deltas-only", () => {
    const r = runAgy(buildAgyArgs({}), { prompt: "x", timeout: 30000 });
    assert.equal(r.ok, true);
    assert.equal(r.response, "Answer from deltas.");
    assert.equal(r.empty, false);
  }));
  it("reports a missing result event with the stderr tail", () => withFakeAgy("no-result", () => {
    const r = runAgy(buildAgyArgs({}), { prompt: "x", timeout: 30000 });
    assert.equal(r.ok, false);
    assert.equal(r.status, 0);
    assert.match(r.error, /agy produced no result event: warning: stream closed early/);
    assert.equal(r.empty, false);
  }));
  it("flags a read-only run whose init reports another permission mode", () => withFakeAgy("auto-mode", () => {
    const r = runAgy(buildAgyArgs({}), { prompt: "x", timeout: 30000 });
    assert.equal(r.ok, false);
    assert.equal(r.readOnlyViolated, true);
    assert.equal(r.permissionMode, "auto");
    assert.equal(r.error, "agy did not honour read-only mode (permission_mode=auto); files may have been modified — check `git status`");
  }));
  it("fails a read-only run whose output has no init event", () => withFakeAgy("no-init", () => {
    const r = runAgy(buildAgyArgs({}), { prompt: "x", timeout: 30000 });
    assert.equal(r.ok, false);
    assert.equal(r.readOnlyViolated, true);
    assert.equal(r.permissionMode, null);
    assert.equal(r.error, "agy did not report its permission mode; read-only mode could not be verified — check `git status`");
  }));
  it("accepts a write run with no init event", () => withFakeAgy("no-init", () => {
    const r = runAgy(buildAgyArgs({ write: true }), { prompt: "x", timeout: 30000 });
    assert.equal(r.ok, true);
    assert.equal(r.readOnlyViolated, false);
  }));
  it("does not apply the read-only check to write runs", () => withFakeAgy("auto-mode", () => {
    const r = runAgy(buildAgyArgs({ write: true }), { prompt: "x", timeout: 30000 });
    assert.equal(r.ok, true);
    assert.equal(r.readOnlyViolated, false);
  }));
  it("maps agy's print-timeout exit (3) to timedOut", () => withFakeAgy("slow", () => {
    const r = runAgy(buildAgyArgs({}), { prompt: "x", timeout: 1000 });
    assert.equal(r.ok, false);
    assert.equal(r.timedOut, true);
    assert.equal(r.status, 3);
    assert.equal(r.error, "agy timed out after 1s");
    assert.match(r.stderr, /AGY_ERROR/);
  }));
  it("adds the sign-in hint to authentication errors", () => withFakeAgy("auth-error", () => {
    const r = runAgy(buildAgyArgs({}), { prompt: "x", timeout: 30000 });
    assert.equal(r.ok, false);
    assert.ok(r.error.startsWith("authentication failed or timed out"));
    assert.ok(r.error.includes(AUTH_HINT));
  }));
  it("does not label other errors as authentication problems", () => withFakeAgy("quota-error", () => {
    const r = runAgy(buildAgyArgs({}), { prompt: "x", timeout: 30000 });
    assert.equal(r.ok, false);
    assert.equal(r.error, "RESOURCE_EXHAUSTED: quota exceeded for model gemini-4-argon");
  }));
  it("reports a crash with its exit status and stderr", () => withFakeAgy("crash", () => {
    const r = runAgy(buildAgyArgs({}), { prompt: "x", timeout: 30000 });
    assert.equal(r.ok, false);
    assert.match(r.error, /agy exited with status 2: panic: something went wrong/);
  }));
});

describe("getAgyLoginStatus (fake agy)", () => {
  it("reports signed in when the probe answers exactly OK", () => withFakeAgy("auth-ok", (bin) => {
    assert.deepEqual(getAgyLoginStatus(), { available: true, loggedIn: true, detail: null });
    assert.equal(readFakeAgyCalls(bin).length, 1); // one live probe; --version/models not logged
  }));
  it("stops at `agy models` when signed out, without a model call", () => withFakeAgy("auth-error", (bin) => {
    const s = getAgyLoginStatus();
    assert.equal(s.available, true);
    assert.equal(s.loggedIn, false);
    assert.ok(s.detail.includes(AUTH_HINT));
    assert.match(s.detail, /not signed in/);
    assert.equal(readFakeAgyCalls(bin).length, 0);
  }));
  it("rejects a reply that merely contains OK", () => withFakeAgy("chatty", () => {
    const s = getAgyLoginStatus();
    assert.equal(s.loggedIn, false);
    assert.match(s.detail, /unexpectedly/);
  }));
  it("accepts OK with surrounding punctuation and any case", () => withFakeAgy("auth-ok-punctuated", () => {
    assert.equal(getAgyLoginStatus().loggedIn, true);
  }));
  it("rejects an unrelated reply", () => withFakeAgy("task-ok", () => {
    assert.equal(getAgyLoginStatus().loggedIn, false);
  }));
  it("reports quota errors raw, not as authentication", () => withFakeAgy("quota-error", () => {
    const s = getAgyLoginStatus();
    assert.equal(s.loggedIn, false);
    assert.match(s.detail, /RESOURCE_EXHAUSTED/);
    assert.match(s.detail, /not an authentication error/);
    assert.ok(!s.detail.includes(AUTH_HINT));
  }));
  it("reports an authentication failure from the probe as such", () => withFakeAgy("auth-error", () => {
    process.env.GEMINI_API_KEY = "dummy"; // skips the `agy models` pre-check
    const s = getAgyLoginStatus();
    assert.equal(s.loggedIn, false);
    assert.match(s.detail, /^authentication failed/);
    assert.ok(s.detail.includes(AUTH_HINT));
  }));
});

describe("parseStructuredOutput", () => {
  it("parses valid JSON", () => {
    const result = parseStructuredOutput(JSON.stringify({ verdict: "approve", summary: "OK", findings: [], next_steps: [] }));
    assert.equal(result.parsed.verdict, "approve");
    assert.equal(result.parseError, null);
  });
  it("returns parseError for invalid JSON", () => {
    const result = parseStructuredOutput("not json");
    assert.equal(result.parsed, null);
    assert.ok(result.parseError);
  });
  it("extracts JSON from markdown fences", () => {
    const result = parseStructuredOutput('```json\n{"verdict":"approve","summary":"OK","findings":[],"next_steps":[]}\n```');
    assert.equal(result.parsed.verdict, "approve");
  });
  it("extracts a JSON object surrounded by prose", () => {
    const result = parseStructuredOutput('Here is my review:\n{"verdict":"approve","summary":"OK","findings":[]}\nThanks!');
    assert.equal(result.parsed.verdict, "approve");
  });
  it("returns parseError for empty", () => {
    const result = parseStructuredOutput("");
    assert.equal(result.parsed, null);
    assert.ok(result.parseError);
  });
});
