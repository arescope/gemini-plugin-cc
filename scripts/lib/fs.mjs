// scripts/lib/fs.mjs
import fs from "node:fs";
import path from "node:path";

export function readStdinIfPiped() {
  if (process.stdin.isTTY) return "";
  try { return fs.readFileSync(0, "utf8").trim(); } catch { return ""; }
}

export function readJsonFile(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, "utf8")); } catch { return null; }
}

export function ensureAbsolutePath(cwd, maybePath) {
  return path.isAbsolute(maybePath) ? maybePath : path.resolve(cwd, maybePath);
}

export function writeJsonFile(filePath, value) {
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}

export function safeReadFile(filePath) {
  try { return fs.readFileSync(filePath, "utf8"); } catch { return null; }
}
