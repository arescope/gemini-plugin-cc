// scripts/lib/args.mjs

/**
 * @param {string[]} argv
 * @param {{ valueOptions?: string[], booleanOptions?: string[], aliasMap?: Record<string, string> }} [config]
 * @returns {{ options: Record<string, any>, positionals: string[] }}
 */
export function parseArgs(argv, config = {}) {
  const valueSet = new Set(config.valueOptions ?? []);
  const boolSet = new Set(config.booleanOptions ?? []);
  const aliasMap = config.aliasMap ?? {};
  /** @type {Record<string, any>} */
  const options = {};
  /** @type {string[]} */
  const positionals = [];
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const name = arg.slice(2);
      const eq = name.indexOf("=");
      if (eq > 0 && valueSet.has(name.slice(0, eq))) { options[name.slice(0, eq)] = name.slice(eq + 1); }
      else if (valueSet.has(name) && i + 1 < argv.length) { options[name] = argv[++i]; }
      else if (boolSet.has(name)) { options[name] = true; }
      else { positionals.push(arg); }
    } else if (arg.startsWith("-") && arg.length === 2) {
      const resolved = aliasMap[arg.slice(1)];
      if (resolved && valueSet.has(resolved) && i + 1 < argv.length) { options[resolved] = argv[++i]; }
      else if (resolved && boolSet.has(resolved)) { options[resolved] = true; }
      else { positionals.push(arg); }
    } else { positionals.push(arg); }
    i++;
  }
  return { options, positionals };
}
