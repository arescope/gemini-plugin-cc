// tests/gemini.test.mjs
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveModelAlias, resolveEffort, buildModelFlag, buildEffortFlag, parseStructuredOutput } from "../scripts/lib/gemini.mjs";

describe("resolveModelAlias", () => {
  it("resolves flash", () => assert.equal(resolveModelAlias("flash"), "gemini-3-flash-preview"));
  it("resolves fast", () => assert.equal(resolveModelAlias("fast"), "gemini-3-flash-preview"));
  it("resolves pro", () => assert.equal(resolveModelAlias("pro"), "gemini-3.1-pro-preview"));
  it("resolves deep", () => assert.equal(resolveModelAlias("deep"), "gemini-3.1-pro-preview"));
  it("resolves lite", () => assert.equal(resolveModelAlias("lite"), "gemini-2.5-flash-lite"));
  it("resolves flash-2", () => assert.equal(resolveModelAlias("flash-2"), "gemini-2.5-flash"));
  it("resolves pro-2", () => assert.equal(resolveModelAlias("pro-2"), "gemini-2.5-pro"));
  it("passes through full names", () => assert.equal(resolveModelAlias("gemini-2.5-flash"), "gemini-2.5-flash"));
  it("returns null for null", () => assert.equal(resolveModelAlias(null), null));
  it("returns null for empty", () => assert.equal(resolveModelAlias(""), null));
});

describe("resolveEffort", () => {
  it("maps low", () => assert.equal(resolveEffort("low"), "low"));
  it("maps l", () => assert.equal(resolveEffort("l"), "low"));
  it("maps medium", () => assert.equal(resolveEffort("medium"), "medium"));
  it("maps med", () => assert.equal(resolveEffort("med"), "medium"));
  it("maps high", () => assert.equal(resolveEffort("high"), "high"));
  it("maps xhigh to high", () => assert.equal(resolveEffort("xhigh"), "high"));
  it("maps max to high", () => assert.equal(resolveEffort("max"), "high"));
  it("maps none", () => assert.equal(resolveEffort("none"), "none"));
  it("passes numeric", () => assert.equal(resolveEffort("8192"), "8192"));
  it("returns null for null", () => assert.equal(resolveEffort(null), null));
});

describe("buildModelFlag", () => {
  it("returns flag array for alias", () => assert.deepEqual(buildModelFlag("flash"), ["--model", "gemini-3-flash-preview"]));
  it("returns empty for null", () => assert.deepEqual(buildModelFlag(null), []));
});

describe("buildEffortFlag", () => {
  it("returns empty for any level (not yet supported by CLI)", () => assert.deepEqual(buildEffortFlag("high"), []));
  it("returns empty for null", () => assert.deepEqual(buildEffortFlag(null), []));
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
  it("returns parseError for empty", () => {
    const result = parseStructuredOutput("");
    assert.equal(result.parsed, null);
    assert.ok(result.parseError);
  });
});
