// lint-skill.ts — SKILL.md frontmatter validator for PR review (spec 0258 R11).
// Checks: required fields, version bumped vs base branch, and (spec 0289) that every
// `scripts/...` path cited in a SKILL.md body or its references/**/*.md resolves inside the
// skill's own directory or sits inside a `<!-- crewrig-repo-only:start/end -->` fence.
// The citation check needs no js-yaml and runs whichever frontmatter leg is active.
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

  const FENCE_START = "<!-- crewrig-repo-only:start -->";
  const FENCE_END = "<!-- crewrig-repo-only:end -->";
  const CITATION =
    /(?:^|[\s`"'(])(?:\.\/)?(scripts\/[A-Za-z0-9_./-]*[A-Za-z0-9_-]\.(?:ts|js|mjs|py|sh))(?![A-Za-z0-9_-])/g;

  /** Every `references/**` Markdown file under a skill directory, sorted. */
  function referenceFiles(dir: string): string[] {
    const out: string[] = [];
    const walk = (d: string): void => {
      let entries: string[] = [];
      try {
        entries = fs.readdirSync(d).sort();
      } catch {
        return;
      }
      for (const name of entries) {
        const full = path.join(d, name);
        try {
          const st = fs.statSync(full);
          if (st.isDirectory()) walk(full);
          else if (st.isFile() && name.endsWith(".md")) out.push(full);
        } catch {
          // unreadable entry: skip
        }
      }
    };
    walk(path.join(dir, "references"));
    return out;
  }

  /** Citation findings of one Markdown file: `<line>: <message>` strings in line order. */
  function citationFindings(
    skillDir: string,
    skillName: string,
    text: string,
    skipFrontmatter: boolean,
  ): { line: number; message: string }[] {
    const found: { line: number; message: string }[] = [];
    const lines = text.split("\n");
    let i = 0;
    if (skipFrontmatter && DELIM.test(lines[0] as string)) {
      i = 1;
      while (i < lines.length && !DELIM.test(lines[i] as string)) i++;
      i++;
    }
    let fence = 0; // line number where the open repo-only fence started, 0 when none
    let code: { ch: string; len: number; skip: boolean } | undefined;
    for (; i < lines.length; i++) {
      const raw = (lines[i] as string).replace(/\r$/, "");
      const lineNo = i + 1;
      const fm = /^ {0,3}(`{3,}|~{3,})[ \t]*([^\s`]*)/.exec(raw);
      if (code !== undefined) {
        const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(raw);
        if (close !== undefined && close !== null) {
          const run = close[1] as string;
          if (run.startsWith(code.ch) && run.length >= code.len) code = undefined;
          continue;
        }
      } else if (fm !== null) {
        const run = fm[1] as string;
        const lang = (fm[2] as string).toLowerCase();
        code = {
          ch: run.charAt(0),
          len: run.length,
          skip: lang === "yaml" || lang === "yml",
        };
        continue;
      }
      if (code === undefined) {
        const trimmed = raw.trim();
        if (trimmed === FENCE_START) {
          if (fence !== 0)
            found.push({
              line: lineNo,
              message: "nested crewrig-repo-only fence (start inside an open fence)",
            });
          else fence = lineNo;
          continue;
        }
        if (trimmed === FENCE_END) {
          if (fence === 0)
            found.push({
              line: lineNo,
              message: "stray crewrig-repo-only end marker (no open fence)",
            });
          fence = 0;
          continue;
        }
      } else if (code.skip) {
        continue;
      }
      if (fence !== 0) continue;
      CITATION.lastIndex = 0;
      for (let m = CITATION.exec(raw); m !== null; m = CITATION.exec(raw)) {
        const cited = m[1] as string;
        let resolved = false;
        if (!cited.includes("..")) {
          try {
            resolved = fs.statSync(path.join(skillDir, cited)).isFile();
          } catch {
            resolved = false;
          }
        }
        if (!resolved)
          found.push({
            line: lineNo,
            message: `unresolved script citation ${cited} (not in ${skillName}/scripts, not in a crewrig-repo-only fence)`,
          });
      }
    }
    if (fence !== 0)
      found.push({
        line: fence,
        message: "unterminated crewrig-repo-only fence (no end marker)",
      });
    return found;
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

    if (path.basename(file) === "SKILL.md") {
      const skillDir = path.dirname(file);
      const skillName = path.basename(path.resolve(skillDir));
      const targets: { name: string; body: string; frontmatter: boolean }[] = [
        { name: file, body: text, frontmatter: true },
      ];
      for (const ref of referenceFiles(skillDir)) {
        try {
          targets.push({
            name: ref,
            body: fs.readFileSync(ref).toString("latin1"),
            frontmatter: false,
          });
        } catch {
          // unreadable reference: nothing to scan
        }
      }
      for (const t of targets) {
        for (const f of citationFindings(skillDir, skillName, t.body, t.frontmatter)) {
          say(`${t.name}:${f.line}: ${f.message}\n`);
          findings = 1;
        }
      }
    }
  }

  process.exitCode = findings;
})();
