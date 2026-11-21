// scripts/lib/git.mjs
import fs from "node:fs";
import path from "node:path";
import { runCommand } from "./process.mjs";

const MAX_UNTRACKED_FILES = 50;
const MAX_UNTRACKED_FILE_BYTES = 200 * 1024;

/** @param {string} cwd */
export function ensureGitRepository(cwd) {
  const result = runCommand("git", ["rev-parse", "--git-dir"], { cwd });
  if (result.status !== 0) throw new Error(`${cwd} is not a git repository.`);
}

/** @param {string} cwd @param {{ base?: string }} [options] */
export function resolveReviewTarget(cwd, options = {}) {
  // A ref starting with "-" would reach `git diff` as an option (e.g. --output=<file>).
  if (options.base?.startsWith("-")) throw new Error(`Invalid --base value ${JSON.stringify(options.base)}: must be a git ref, not an option`);
  if (options.base) return { mode: "branch", baseRef: options.base, label: `branch diff against ${options.base}` };
  return { mode: "working-tree", label: "uncommitted changes" };
}

/** @param {string} cwd */
export function getRepoRoot(cwd) {
  return runCommand("git", ["rev-parse", "--show-toplevel"], { cwd }).stdout;
}

/** @param {string} cwd */
export function getCurrentBranch(cwd) {
  return runCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd }).stdout;
}

/**
 * Contents of new, not-yet-tracked files. `git diff` never shows these, yet
 * they are often most of a change, so include them (bounded) in the review.
 * @param {string} cwd
 * @param {string} repoRoot
 */
export function collectUntrackedFiles(cwd, repoRoot) {
  const listed = runCommand("git", ["ls-files", "--others", "--exclude-standard", "--full-name"], { cwd: repoRoot || cwd }).stdout;
  const files = listed ? listed.split(/\r?\n/).filter(Boolean) : [];
  const sections = [];
  const skipped = [];
  for (const rel of files) {
    if (sections.length >= MAX_UNTRACKED_FILES) { skipped.push(`${rel} (file limit reached)`); continue; }
    try {
      const abs = path.join(repoRoot || cwd, rel);
      const stat = fs.statSync(abs);
      if (!stat.isFile()) continue;
      if (stat.size > MAX_UNTRACKED_FILE_BYTES) { skipped.push(`${rel} (${stat.size} bytes, too large)`); continue; }
      const buf = fs.readFileSync(abs);
      if (buf.includes(0)) { skipped.push(`${rel} (binary)`); continue; }
      sections.push(`+++ new file: ${rel}\n${buf.toString("utf8")}`);
    } catch { skipped.push(`${rel} (unreadable)`); }
  }
  return { count: files.length, sections, skipped };
}

/**
 * @param {string} cwd
 * @param {{ mode: string, baseRef?: string, label: string }} target
 */
export function collectReviewContext(cwd, target) {
  const repoRoot = getRepoRoot(cwd);
  const branch = getCurrentBranch(cwd);
  let diff, summary;
  /** @type {{ count: number, sections: string[], skipped: string[] }} */
  let untracked = { count: 0, sections: [], skipped: [] };
  if (target.mode === "branch") {
    const range = `${target.baseRef}...HEAD`;
    const result = runCommand("git", ["diff", range], { cwd });
    if (result.status !== 0) throw new Error(`Could not diff against "${target.baseRef}": ${result.stderr || "unknown git error"}`);
    diff = result.stdout;
    summary = runCommand("git", ["diff", "--shortstat", range], { cwd }).stdout;
  } else {
    const staged = runCommand("git", ["diff", "--cached"], { cwd }).stdout;
    const unstaged = runCommand("git", ["diff"], { cwd }).stdout;
    diff = [staged, unstaged].filter(Boolean).join("\n");
    const head = runCommand("git", ["diff", "--shortstat", "HEAD"], { cwd });
    summary = head.status === 0 ? head.stdout : runCommand("git", ["diff", "--shortstat", "--cached"], { cwd }).stdout;
    untracked = collectUntrackedFiles(cwd, repoRoot);
  }
  const status = runCommand("git", ["status", "--short", "--untracked-files=all"], { cwd }).stdout;
  const isEmpty = !diff && untracked.count === 0;
  const parts = [`Branch: ${branch}`, `Target: ${target.label}`, `Summary: ${summary || "(no tracked changes)"}`, "", "--- Diff ---", diff || "(empty diff)"];
  if (untracked.sections.length > 0) parts.push("", "--- New Untracked Files ---", untracked.sections.join("\n\n"));
  if (untracked.skipped.length > 0) parts.push("", "--- Untracked Files Not Shown ---", untracked.skipped.join("\n"));
  parts.push("", "--- Working Tree Status ---", status || "(clean)");
  return { repoRoot, branch, target, summary: summary || "(no changes)", isEmpty, content: parts.join("\n") };
}
