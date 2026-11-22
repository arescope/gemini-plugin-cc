# Changelog

## 2.0.1

Windows reliability fix. No behaviour changes on macOS or Linux.

### Fixed
- Windows: concurrent jobs and hooks could fail with `EPERM` while updating `.gemini-tasks/state.json`, because Windows reports a lock directory being deleted, or a state file another process has open, as `EPERM` instead of `EEXIST`. These transient errors are now retried.

### Other
- README: CI, release, version, Node, license, platform and requirement badges.
- Tests: temp-directory cleanup retries on Windows, where a just-finished background worker can still hold the directory.

## 2.0.0

The plugin now drives Google's **Antigravity CLI (`agy`)** instead of the Gemini CLI, and fixes a set of reliability bugs in job control and failure handling. Built and smoke-tested against agy 1.5.9.

### Breaking
- **Backend replaced.** `agy` is required; the Gemini CLI is no longer used. Install with `curl -fsSL https://antigravity.google/cli/install.sh | bash` and sign in by running `agy` once (or set `GEMINI_API_KEY`).
- **Model aliases point at Gemini 4.** `pro` / `argon` → `gemini-4-argon`, `deep` / `carbon` → `gemini-4-carbon`, `hydrogen` → `gemini-4-hydrogen`, `flash` / `fast` / `lite` → `gemini-3.8-flash`. `flash-2`, `pro-2` and `auto` are gone. Any other value is passed to agy unchanged.
- **Runs are read-only unless `--write` is given.** agy's headless default (Auto mode) edits files without asking, so the plugin pins runs to review-required permissions; `--write` maps to `--dangerously-skip-permissions`.
- **Commands exit 1 on failure** where they previously exited 0 with empty output.
- `setup --json` reports `agyAvailable` / `agyVersion` (was `geminiAvailable` / `geminiVersion`).
- Minimum Node.js is 20.

### Hardened (code-review follow-ups)
- **Concurrent state writes no longer lose updates.** `state.json` updates take a lock (`.gemini-tasks/state.lock`), so parallel background jobs, cancel and hooks cannot overwrite each other; a lock left by a crashed process is broken after 1s.
- **The `gemini-consult` subagent is read-only by default.** It adds `--write` only when the user explicitly asks Gemini to modify files.
- **Read-only runs fail if agy does not report its permission mode** (no `init` event), instead of passing unverified.
- **Ambiguous job IDs are rejected.** `status`, `result` and `cancel` with a prefix matching several jobs exit 1 with `Ambiguous job ID … matches: …`; a unique prefix still works.
- **`--base` values starting with `-` are rejected**, so they cannot reach `git diff` as options.
- **Gemini output is shown unmodified.** The tag/line-stripping output filter was removed: it applied only to some paths, deleted legitimate content and was easy to bypass.
- **An empty review is an error.** A review or challenge that returns no text exits 1 with agy's stderr (where it reports denied tools) instead of printing a bare header. When agy's result event has an empty `response`, the text streamed in `agent_response` steps is used.
- **Windows:** `git` and `agy --version` no longer run through a shell (fixes Node's DEP0190 warning), and no console windows flash.
- **Consult runs are tracked jobs.** The `gemini-consult` subagent starts a background `task` and waits on it with the new `result <id> --wait`, so its runs show in `/gemini:status` with a progress log and can be stopped with `/gemini:cancel`. `--wait` gives up after 9 minutes and reports the job as still running.
- **A finished job with no text says so** (`(agy returned no text)`) instead of printing a bare header.
- **The state lock cannot spin forever**: a lock that cannot be removed now ends in the timeout error.
- **CI runs on Windows too.** `GEMINI_AGY_COMMAND` (a JSON array, e.g. `["node","/path/agy"]`) overrides how agy is started; the tests use it to run the fake agy on Windows.
- Removed dead code: `splitRawArgumentString`, `getWorkingTreeState`, `resolveJobsDir`, `detectDefaultBranch`, and the unused `scripts/lib/types.d.ts`.
- **Read-only is verified at runtime.** The permission mode agy reports in its `init` event must be `request-review` for non-`--write` runs; otherwise the run fails with `agy did not honour read-only mode … check git status`. The stop gate surfaces this prominently and never blocks on it.
- **`--resume-last` can no longer resume the wrong conversation.** It uses only the id recorded by the most recent `task` run (newest start wins, so a slow background task cannot hijack the pointer) and never agy's `--continue`. `task-resume-candidate` reports `resumable` only when an id exists. A failed resume says how to start fresh.
- **User-supplied flag values use `--flag=value`** (`--add-dir`, `--model`, `--effort`, `--conversation`, `--settings`); whitespace in model, effort or conversation values is rejected up front, including for `--background`.
- **Result parsing:** only agy's `result` event counts (a stray `{status,response}` line is ignored); an empty successful reply is no longer an error; a run with no result event reports agy's stderr. Timeouts (including agy's `--print-timeout` exit code 3) are detected explicitly.
- **`/gemini:setup`** checks sign-in with `agy models` (no model call), requires an exact `OK` reply from the test prompt, and no longer mislabels quota or network failures as authentication problems.
- **Stop gate:** a review that times out is not re-run on every stop; `GEMINI_GATE_TIMEOUT_MS` overrides the 780s default.
- **Zombie workers:** `isProcessAlive` treats exited-but-unreaped processes as dead on Linux, so jobs whose worker crashed are reported as failed instead of running forever.
- `types.d.ts` now describes the agy-based runtime.

### Added
- **`--effort` works.** It is passed to `agy --effort` (`low`, `medium`, `high`, `xhigh`, `max`); previously it was accepted and ignored.
- `--resume-last` continues the exact previous task conversation by ID rather than "whatever ran last".
- Distributed through the `arescope/claude-plugins` marketplace (this repo no longer ships its own `marketplace.json`).
- `task --prompt-file <path>` for long prompts; `--key=value` option syntax.
- `GEMINI_COMPANION_TIMEOUT_MS` to override the 10-minute run timeout (also passed to agy as `--print-timeout`).
- Type-checking (`npm run typecheck`) in CI, and end-to-end tests for failure handling, background jobs, cancellation, session cleanup, and the review gate.

### Fixed
- **Failures were reported as success.** A failed run (not authenticated, quota, timeout) printed an empty result and background jobs finished as `done`. Commands now exit non-zero with the CLI's own error message, and background jobs end as `error`.
- **Cancel and session cleanup targeted the wrong process.** Jobs recorded the PID of the short-lived launcher instead of the detached worker, so `/gemini:cancel` and the SessionEnd hook never stopped a running job. The worker PID is now recorded and its process group terminated.
- **Session cleanup never matched any job.** The session ID was read from an environment variable nothing set. The SessionStart hook now exports `GEMINI_COMPANION_SESSION_ID` via `CLAUDE_ENV_FILE`.
- **Large background reviews could fail to start.** The whole prompt (including the diff) was passed to the worker on the command line. Prompts now go through a per-job file and reach the model on stdin.
- **Large diffs were silently truncated** at Node's default 1 MB child-process buffer.
- **Background reviews rendered as raw JSON** instead of a formatted review.
- **Stop review gate** ran on almost every turn (its "did Claude edit code" heuristic matched any message containing words like "file"), ignored `stop_hook_active`, and failed silently. It now runs only when there are uncommitted changes it has not yet reviewed, never re-fires on its own block, and surfaces a warning when the model is unavailable.
- Setup hints named a non-existent npm package and a non-existent login command.
- `/gemini:analyze --files` and `--background` were accepted but ignored.
- A malformed finding in the model's JSON (missing severity or confidence) crashed review rendering.

### Changed
- Working-tree reviews now include the contents of new untracked files; reviewing with no changes returns immediately without calling the model.
- `.gemini-tasks/` now ignores itself in git, state writes are atomic, job output is stored per job rather than in `state.json`, and only the 50 newest finished jobs are kept.
- Jobs whose worker process died are reported as failed rather than "running" forever.
- `/gemini:status` shows duration and last message; `/gemini:status <id>` shows recent log lines.
- `/gemini:setup` no longer installs anything itself; it tells you the install command.

### Removed
- The Windows `cmd.exe` quoting workaround (agy is a native binary), unused `scripts/lib/fs.mjs`, and other dead helpers.

## 1.0.0

Initial release.
