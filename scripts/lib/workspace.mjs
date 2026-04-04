// scripts/lib/workspace.mjs
import fs from "node:fs";
import path from "node:path";

/**
 * Walk up from `cwd` to find the nearest directory containing `.git`.
 * Falls back to `cwd` if no `.git` is found.
 */
export function resolveWorkspaceRoot(cwd) {
  let dir = path.resolve(cwd);
  while (true) {
    if (fs.existsSync(path.join(dir, ".git"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return path.resolve(cwd);
    }
    dir = parent;
  }
}
