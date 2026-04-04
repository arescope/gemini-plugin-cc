// tests/args.test.mjs
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseArgs, splitRawArgumentString } from "../scripts/lib/args.mjs";

describe("splitRawArgumentString", () => {
  it("splits space-separated tokens", () => {
    assert.deepEqual(splitRawArgumentString("--base main --background"), ["--base", "main", "--background"]);
  });
  it("preserves quoted strings", () => {
    assert.deepEqual(splitRawArgumentString('--base "my branch"'), ["--base", "my branch"]);
  });
  it("returns empty array for empty string", () => {
    assert.deepEqual(splitRawArgumentString(""), []);
  });
});

describe("parseArgs", () => {
  it("parses boolean options", () => {
    const { options } = parseArgs(["--background", "--json"], { booleanOptions: ["background", "json"] });
    assert.equal(options.background, true);
    assert.equal(options.json, true);
  });
  it("parses value options", () => {
    const { options } = parseArgs(["--base", "main", "--model", "flash"], { valueOptions: ["base", "model"] });
    assert.equal(options.base, "main");
    assert.equal(options.model, "flash");
  });
  it("collects positionals", () => {
    const { positionals } = parseArgs(["--background", "look", "for", "bugs"], { booleanOptions: ["background"] });
    assert.deepEqual(positionals, ["look", "for", "bugs"]);
  });
  it("resolves aliases", () => {
    const { options } = parseArgs(["-m", "flash"], { valueOptions: ["model"], aliasMap: { m: "model" } });
    assert.equal(options.model, "flash");
  });
});
