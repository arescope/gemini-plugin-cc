// scripts/lib/prompts.mjs
import fs from "node:fs";
import path from "node:path";

/** @param {string} rootDir @param {string} name */
export function loadPromptTemplate(rootDir, name) {
  return fs.readFileSync(path.join(rootDir, "prompts", `${name}.md`), "utf8");
}

/** @param {string} template @param {Record<string, string | null | undefined>} variables */
export function interpolateTemplate(template, variables) {
  let result = template;
  for (const [key, value] of Object.entries(variables)) {
    result = result.replaceAll(`{{${key}}}`, value ?? "");
  }
  return result;
}
