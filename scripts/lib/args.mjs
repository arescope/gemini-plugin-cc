// scripts/lib/args.mjs

export function splitRawArgumentString(raw) {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return [];
  const tokens = [];
  let current = "";
  let inQuote = false;
  for (const ch of trimmed) {
    if (ch === '"') { inQuote = !inQuote; }
    else if (ch === " " && !inQuote) { if (current) tokens.push(current); current = ""; }
    else { current += ch; }
  }
  if (current) tokens.push(current);
  return tokens;
}

export function parseArgs(argv, config = {}) {
  const valueSet = new Set(config.valueOptions ?? []);
  const boolSet = new Set(config.booleanOptions ?? []);
  const aliasMap = config.aliasMap ?? {};
  const options = {};
  const positionals = [];
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const name = arg.slice(2);
      if (valueSet.has(name) && i + 1 < argv.length) { options[name] = argv[++i]; }
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
