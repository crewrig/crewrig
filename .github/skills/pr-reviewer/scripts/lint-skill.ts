// lint-skill.ts — SKILL.md frontmatter validator for PR review (spec 0258 R11).
// Checks: required fields, version bumped vs base branch.
// Usage: node lint-skill.ts <SKILL.md> [SKILL.md ...]
// Env: BASE_REF (default: origin/main)
// Exit 0 = no findings, 1 = findings. The leading `---` block is parsed with `js-yaml`,
// resolved at run time from the script's directory, then from the working directory; when
// it cannot be found the shell's whole-file line fallback runs instead, after a one-line note.
// Self-contained on purpose: no import, built-ins through process.getBuiltinModule.

process.removeAllListeners("warning");

void (async () => {
  const fs = process.getBuiltinModule("node:fs");
  const path = process.getBuiltinModule("node:path");
  const cp = process.getBuiltinModule("node:child_process");
  const nodeModule = process.getBuiltinModule("node:module");

  const NAME = "lint-skill.ts";
  const REQUIRED = [
    "name",
    "description",
    "license",
    "compatibility",
    "metadata.provenance.version",
  ];
  const bin = (s: string): string => Buffer.from(s, "utf8").toString("latin1");
  const unbin = (s: string): string => Buffer.from(s, "latin1").toString("utf8");
  const say = (s: string): void => {
    process.stdout.write(Buffer.from(bin(s), "latin1"));
  };

  interface Yaml {
    load: (source: string, options?: { schema?: unknown }) => unknown;
    loadAll: (source: string, iterator?: null, options?: { schema?: unknown }) => unknown[];
    FAILSAFE_SCHEMA: unknown;
  }

  /** `js-yaml` from the script's own directory first, then from the working directory. */
  function loadYaml(): Yaml | undefined {
    const bases: string[] = [];
    try {
      bases.push(path.dirname(fs.realpathSync(process.argv[1] ?? "")));
    } catch {
      // no script directory to resolve from
    }
    bases.push(process.cwd());
    for (const base of bases) {
      try {
        const mod: unknown = nodeModule.createRequire(path.join(base, "noop.js"))("js-yaml");
        const m = mod as Partial<Yaml>;
        if (
          typeof m.load === "function" &&
          typeof m.loadAll === "function" &&
          m.FAILSAFE_SCHEMA !== undefined
        )
          return m as Yaml;
      } catch {
        // not resolvable from here
      }
    }
    return undefined;
  }

  const DELIM = /^---[ \t\n\v\f\r]*$/;
  /** The leading `---` block: line 1 must be a delimiter; it ends at the next one or at EOF. */
  function frontmatter(text: string): string {
    const lines = text.split("\n");
    if (!DELIM.test(lines[0] as string)) return "";
    const out: string[] = [];
    for (let i = 1; i < lines.length && !DELIM.test(lines[i] as string); i++)
      out.push(lines[i] as string);
    return out.join("\n");
  }

  /** The first YAML document of the block (what `yq` evaluates first); `undefined` when none. */
  function firstDocument(yaml: Yaml, block: string, schema?: unknown): unknown {
    const options = schema === undefined ? {} : { schema };
    try {
      return yaml.loadAll(block, null, options)[0];
    } catch {
      // a later document may be broken: keep what precedes the first document marker
      const lines = block.split("\n");
      const marker = lines.findIndex((line, i) => i > 0 && /^---(?:[ \t]|$)/.test(line));
      if (marker === -1) return undefined;
      try {
        return yaml.load(lines.slice(0, marker).join("\n"), options);
      } catch {
        return undefined;
      }
    }
  }

  /** The value of a dotted key as text, `""` when missing, null, false, empty or not parseable. */
  function yamlValue(yaml: Yaml, text: string, key: string): string {
    const block = unbin(frontmatter(text));
    let typed = firstDocument(yaml, block);
    let raw = firstDocument(yaml, block, yaml.FAILSAFE_SCHEMA);
    const plain = (v: unknown): v is Record<string, unknown> =>
      typeof v === "object" && v !== null && !Array.isArray(v);
    for (const part of key.split(".")) {
      if (!plain(typed) || !plain(raw) || !Object.hasOwn(typed, part)) return "";
      typed = typed[part];
      raw = raw[part];
    }
    if (typed === null || typed === undefined || typed === false) return "";
    if (typeof raw !== "string") return "{}";
    let end = raw.length;
    while (end > 0 && raw[end - 1] === "\n") end--;
    const value = raw.slice(0, end);
    return value === "null" ? "" : bin(value);
  }

  const lineHasKey = (leaf: string): RegExp =>
    new RegExp(`^[ \\t\\n\\v\\f\\r]*${leaf}:[ \\t\\n\\v\\f\\r]*[^ \\t\\n\\v\\f\\r]`);

  /** The shell's fallback: the leaf of the key on any line of the whole file. */
  function fallbackHasKey(text: string, key: string): boolean {
    const re = lineHasKey(key.slice(key.lastIndexOf(".") + 1));
    return text.split("\n").some((line) => re.test(line));
  }

  /** The shell's awk: second field of the first `version:` line, quotes and blanks removed. */
  function fallbackVersion(text: string): string {
    for (const line of text.split("\n")) {
      if (!/^[ \t\n\v\f\r]*version:/.test(line)) continue;
      const fields = line.split(/[ \t]+/).filter((f) => f !== "");
      return (fields[1] ?? "").replace(/["]/g, "");
    }
    return "";
  }

  /** `git show <ref>:<path>` as latin1 text; `undefined` on any failure. */
  function baseContent(ref: string, file: string): string | undefined {
    const res = cp.spawnSync("git", ["show", `${ref}:${file}`], {
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 256 * 1024 * 1024,
    });
    if (res.error !== undefined || res.status !== 0) return undefined;
    return res.stdout.toString("latin1");
  }

  const files = process.argv.slice(2);
  if (files.length === 0) {
    say(`${NAME}: no files supplied — nothing to check.\n`);
    return;
  }
  const requested = process.env["BASE_REF"];
  const baseRef = requested === undefined || requested === "" ? "origin/main" : requested;
  const yaml = loadYaml();
  if (yaml === undefined)
    say(
      "lint-skill: js-yaml not found — using line fallback for the required keys and the version; run it from a CrewRig checkout after setup for the full check.\n",
    );
  let findings = 0;

  const versionOf = (text: string): string =>
    yaml === undefined
      ? fallbackVersion(text)
      : yamlValue(yaml, text, "metadata.provenance.version");

  for (const file of files) {
    let regular = false;
    try {
      regular = fs.statSync(file).isFile();
    } catch {
      regular = false;
    }
    if (!regular) {
      say(`${file}: not a regular file\n`);
      findings = 1;
      continue;
    }
    let text = "";
    try {
      text = fs.readFileSync(file).toString("latin1");
    } catch {
      // unreadable: every key reads as missing, like the shell's silent awk and grep
    }

    for (const key of REQUIRED) {
      const present =
        yaml === undefined ? fallbackHasKey(text, key) : yamlValue(yaml, text, key) !== "";
      if (!present) {
        say(`${file}: missing required frontmatter key: ${key}\n`);
        findings = 1;
      }
    }

    const headVersion = versionOf(text);
    const blob = baseContent(baseRef, file);
    const baseVersion = blob === undefined ? "" : versionOf(blob);
    if (baseVersion !== "" && headVersion === baseVersion) {
      process.stdout.write(
        Buffer.from(
          `${bin(`${file}: version not bumped vs ${baseRef} (still `)}${headVersion})\n`,
          "latin1",
        ),
      );
      findings = 1;
    }
  }

  process.exitCode = findings;
})();
