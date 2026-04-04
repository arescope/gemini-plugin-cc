// tests/fake-gemini-fixture.mjs
import fs from "node:fs";
import path from "node:path";

/**
 * Install a fake `gemini` script into binDir that echoes canned responses.
 * On Windows, creates a .cmd file; on Unix, a bash script.
 */
export function installFakeGemini(binDir, behavior = "review-ok") {
  fs.mkdirSync(binDir, { recursive: true });

  const responses = {
    "review-ok": JSON.stringify({
      verdict: "approve",
      summary: "Code looks good.",
      findings: [],
      next_steps: [],
    }),
    "review-findings": JSON.stringify({
      verdict: "needs-attention",
      summary: "Issues found.",
      findings: [
        {
          severity: "high",
          title: "Missing null check",
          body: "Variable could be null at line 42.",
          file: "src/main.js",
          line_start: 42,
          line_end: 42,
          confidence: 0.9,
          recommendation: "Add a null check before accessing the property.",
        },
      ],
      next_steps: ["Fix the null check"],
    }),
    "task-ok": "Task completed successfully. Modified 2 files.",
    "gate-allow": "ALLOW: No blocking issues found.",
    "gate-block": "BLOCK: Missing error handling in auth module.",
    "version": "gemini-cli/1.0.0-fake",
    "auth-ok": "OK",
    "error": "Error: Something went wrong",
  };

  const output = responses[behavior] ?? responses["task-ok"];
  const exitCode = behavior === "error" ? 1 : 0;

  if (process.platform === "win32") {
    // On Windows, write a Node.js helper script and a .cmd wrapper that invokes it.
    // This avoids CMD echo escaping issues with special characters (quotes, braces, etc.).
    const helperPath = path.join(binDir, "_gemini_fake.js");
    const helperContent = "console.log(" + JSON.stringify(output) + ");\nprocess.exit(" + exitCode + ");\n";
    fs.writeFileSync(helperPath, helperContent, "utf8");
    const winHelperPath = helperPath.split("/").join("\\");
    const cmdContent = "@echo off\nnode \"" + winHelperPath + "\"\nexit /b %errorlevel%\n";
    fs.writeFileSync(path.join(binDir, "gemini.cmd"), cmdContent, "utf8");
  } else {
    const shPath = path.join(binDir, "gemini");
    fs.writeFileSync(shPath, `#!/bin/sh\necho '${output.replace(/'/g, "\\'")}'\nexit ${exitCode}\n`, { mode: 0o755 });
  }
}

/**
 * Return a modified PATH with binDir prepended, so the fake gemini is found first.
 */
export function fakeGeminiEnv(binDir) {
  const sep = process.platform === "win32" ? ";" : ":";
  return { ...process.env, PATH: binDir + sep + process.env.PATH };
}
