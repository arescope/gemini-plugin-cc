// scripts/lib/git.mjs
import { runCommand } from "./process.mjs";

export function ensureGitRepository(cwd) {
  const result = runCommand("git", ["rev-parse", "--git-dir"], { cwd });
  if (result.status !== 0) throw new Error(`${cwd} is not a git repository.`);
}

export function resolveReviewTarget(cwd, options = {}) {
  if (options.base) return { mode: "branch", baseRef: options.base, label: `branch diff against ${options.base}` };
  if (options.scope === "branch") {
    const base = detectDefaultBranch(cwd);
    return { mode: "branch", baseRef: base, label: `branch diff against ${base}` };
  }
  return { mode: "working-tree", label: "uncommitted changes" };
}

export function detectDefaultBranch(cwd) {
  const result = runCommand("git", ["symbolic-ref", "refs/remotes/origin/HEAD"], { cwd });
  if (result.status === 0) return result.stdout.replace("refs/remotes/origin/", "");
  const mainCheck = runCommand("git", ["rev-parse", "--verify", "main"], { cwd });
  return mainCheck.status === 0 ? "main" : "master";
}

export function getRepoRoot(cwd) {
  return runCommand("git", ["rev-parse", "--show-toplevel"], { cwd }).stdout;
}

export function getCurrentBranch(cwd) {
  return runCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd }).stdout;
}

export function getWorkingTreeState(cwd) {
  const status = runCommand("git", ["status", "--porcelain"], { cwd }).stdout;
  return { dirty: status.length > 0, status };
}

export function collectReviewContext(cwd, target) {
  const repoRoot = runCommand("git", ["rev-parse", "--show-toplevel"], { cwd }).stdout;
  const branch = runCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd }).stdout;
  let diff, summary;
  if (target.mode === "branch") {
    diff = runCommand("git", ["diff", `${target.baseRef}...HEAD`], { cwd }).stdout;
    summary = runCommand("git", ["diff", "--shortstat", `${target.baseRef}...HEAD`], { cwd }).stdout;
  } else {
    const staged = runCommand("git", ["diff", "--cached"], { cwd }).stdout;
    const unstaged = runCommand("git", ["diff"], { cwd }).stdout;
    diff = [staged, unstaged].filter(Boolean).join("\n");
    summary = runCommand("git", ["diff", "--shortstat"], { cwd }).stdout;
  }
  const status = runCommand("git", ["status", "--short", "--untracked-files=all"], { cwd }).stdout;
  return {
    repoRoot, branch, target, summary: summary || "(no changes)",
    content: [`Branch: ${branch}`, `Target: ${target.label}`, `Summary: ${summary || "(no changes)"}`, "", "--- Diff ---", diff || "(empty diff)", "", "--- Untracked/Modified Files ---", status || "(none)"].join("\n")
  };
}
