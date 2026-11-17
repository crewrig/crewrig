// lint-typescript.ts — TypeScript linter for PR review (spec 0238 R14).
//
// Runs the same Oxlint type-aware pass (R6, R7) and Oxfmt check-mode pass
// (R8) that CI runs, on the *.ts files it is given — CI itself delegates its
// lint and format steps to this script, so both always render the same
// verdict.
//
// Usage: node lint-typescript.ts [--json] [--mode lint|format|both] [--require-tools] <file.ts>...
//   Run it from the repository root (Node >= 24; it runs from its .ts source
//   through Node's built-in type stripping). Non-.ts arguments and files under
//   the built-copy trees are ignored.
//
// Tools resolve from ./node_modules/.bin, then PATH. A missing tool degrades
// gracefully (exit 0 plus a one-line note), like the sibling lint-*.sh
// scripts; with --require-tools a missing tool is a precondition failure (exit 3).
// Exit: 0 clean (max-lines warnings never fail), 1 findings, 2 usage error (unknown option or
// --mode value), 3 an input is not a readable regular file, a tool is missing under
// --require-tools, or oxlint/oxfmt failed to run. With --json it prints one
// {ok, data, findings} object on stdout and the human text on stderr.
//
// Self-contained on purpose: build-components.ts copies it verbatim into the
// four built trees, so it must not import anything from scripts/.

// The body runs inside a function so that these top-level names stay local to the file.
void (() => {
  const cp = process.getBuiltinModule("node:child_process");
  const fs = process.getBuiltinModule("node:fs");
  const path = process.getBuiltinModule("node:path");

  const NAME = "lint-typescript";
  const BUILT_TREES = [".claude/", ".gemini/", ".github/", ".agents/"];

  interface Oxdiag {
    message: string;
    code: string;
    severity: string;
    filename: string;
    line: number | null;
  }

  /** Resolve a tool from ./node_modules/.bin, then PATH; `undefined` when absent. */
  function resolveTool(name: string): string | undefined {
    const local = path.join(process.cwd(), "node_modules", ".bin", name);
    if (fs.existsSync(local)) return local;
    const probe = cp.spawnSync(name, ["--version"], { encoding: "utf8" });
    return probe.error === undefined && probe.status === 0 ? name : undefined;
  }

  function field(obj: object, key: string): unknown {
    return (obj as Record<string, unknown>)[key];
  }

  /** Parse Oxlint's JSON report; `null` when the output is not a report. */
  function parseReport(stdout: string): Oxdiag[] | null {
    const start = stdout.indexOf("{");
    if (start === -1) return null;
    let report: unknown;
    try {
      report = JSON.parse(stdout.slice(start));
    } catch {
      return null;
    }
    if (typeof report !== "object" || report === null) return null;
    const diags = field(report, "diagnostics");
    if (!Array.isArray(diags)) return null;
    return diags.flatMap((d: unknown): Oxdiag[] => {
      if (typeof d !== "object" || d === null) return [];
      const labels = field(d, "labels");
      const first: unknown = Array.isArray(labels) ? labels[0] : undefined;
      const span = typeof first === "object" && first !== null ? field(first, "span") : undefined;
      const line = typeof span === "object" && span !== null ? field(span, "line") : undefined;
      return [
        {
          message: String(field(d, "message") ?? ""),
          code: String(field(d, "code") ?? "oxlint"),
          severity: String(field(d, "severity") ?? "error"),
          filename: String(field(d, "filename") ?? ""),
          line: typeof line === "number" ? line : null,
        },
      ];
    });
  }

  interface Finding {
    rule: string;
    message: string;
    severity?: "warning";
  }

  const USAGE =
    "Usage: node lint-typescript.ts [--json] [--mode lint|format|both] [--require-tools] <file.ts>...\n" +
    "  Oxlint type-aware pass and Oxfmt check. Non-.ts arguments are ignored. Exit 0 clean,\n" +
    "  1 findings, 2 usage error, 3 unreadable input, missing tool under --require-tools or a tool failure.\n";

  let jsonMode = false;
  const found: Finding[] = [];
  /** One human line: standard output, or standard error under --json. */
  function say(line: string): void {
    (jsonMode ? process.stderr : process.stdout).write(`${line}\n`);
  }
  function report(rule: string, message: string, line: string, severity?: "warning"): void {
    say(line);
    found.push(severity === undefined ? { rule, message } : { rule, message, severity });
  }

  function lint(tool: string, files: string[]): number {
    const res = cp.spawnSync(tool, ["--type-aware", "--format=json", ...files], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    const diags = parseReport(res.stdout ?? "");
    if (diags === null) {
      const message = `oxlint produced no report: ${(res.stderr ?? "").trim() || (res.stdout ?? "").trim()}`;
      report("precondition", message, `${NAME}: ${message}`);
      return 3;
    }
    let status = 0;
    for (const d of diags) {
      const where = d.line === null ? d.filename : `${d.filename}:${d.line}`;
      const message = `${where}: ${d.message}`;
      if (d.severity === "error") {
        report(d.code, message, `${NAME}: ${d.code}: ${message}`);
        status = 1;
      } else {
        report(
          d.code,
          message,
          `warning (non-blocking): ${NAME}: ${d.code}: ${message}`,
          "warning",
        );
      }
    }
    return status;
  }

  function format(tool: string, files: string[]): number {
    const res = cp.spawnSync(
      tool,
      ["--list-different", "--no-error-on-unmatched-pattern", ...files],
      {
        encoding: "utf8",
        maxBuffer: 64 * 1024 * 1024,
      },
    );
    if (res.status !== 0 && res.status !== 1) {
      const message = `oxfmt failed: ${(res.stderr ?? "").trim()}`;
      report("precondition", message, `${NAME}: ${message}`);
      return 3;
    }
    const listed = new Set(files);
    const unformatted = (res.stdout ?? "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => listed.has(l));
    for (const file of unformatted) {
      const message = `${file}: not formatted as oxfmt formats it; run \`task format-ts:fix\``;
      report("format", message, `${NAME}: format: ${message}`);
    }
    if (res.status === 1 && unformatted.length === 0) {
      const message = `oxfmt reported unformatted files it did not name: ${(res.stdout ?? "").trim()}`;
      report("format", message, `${NAME}: ${message}`);
    }
    return res.status === 1 ? 1 : 0;
  }

  function finish(code: number, files: string[]): number {
    if (jsonMode) {
      const errors = found.filter((f) => f.severity !== "warning");
      const ok = code === 0;
      const data = code === 2 || code === 3 ? null : { files };
      process.stdout.write(
        `${JSON.stringify({ ok, data, findings: code === 2 || code === 3 ? errors : found })}\n`,
      );
    }
    return code;
  }

  function main(argv: string[]): number {
    let mode = "both";
    let requireTools = false;
    let help = false;
    let usageError: string | undefined;
    const files: string[] = [];
    for (let i = 0; i < argv.length; i += 1) {
      const arg = argv[i] ?? "";
      if (arg === "--json") jsonMode = true;
      else if (arg === "--help" || arg === "-h") help = true;
      else if (arg === "--require-tools") requireTools = true;
      else if (arg === "--mode") mode = argv[++i] ?? "";
      else if (arg.startsWith("--mode=")) mode = arg.slice("--mode=".length);
      else if (arg.startsWith("--")) usageError ??= `unknown option ${arg}`;
      else if (arg.endsWith(".ts") && !BUILT_TREES.some((t) => arg.startsWith(t))) files.push(arg);
    }
    if (help) {
      process.stdout.write(USAGE);
      return 0;
    }
    if (usageError === undefined && !["lint", "format", "both"].includes(mode))
      usageError = `unknown --mode '${mode}' (expected lint, format or both)`;
    if (usageError !== undefined) {
      report("usage", usageError, `${NAME}: ${usageError}`);
      return finish(2, files);
    }
    if (files.length === 0) {
      say(`${NAME}: no *.ts files supplied — nothing to check.`);
      return finish(0, files);
    }
    // every input is checked before anything is linted: an unreadable one wins over a finding
    const unreadable = files.filter((f) => {
      try {
        return !fs.statSync(f).isFile();
      } catch {
        return true;
      }
    });
    if (unreadable.length > 0) {
      for (const f of unreadable)
        report(
          "precondition",
          `${f}: not a readable regular file`,
          `${f}: not a readable regular file`,
        );
      return finish(3, files);
    }
    let status = 0;
    const steps: Array<[string, (tool: string, f: string[]) => number]> = [];
    if (mode !== "format") steps.push(["oxlint", lint]);
    if (mode !== "lint") steps.push(["oxfmt", format]);
    for (const [name, run] of steps) {
      const tool = resolveTool(name);
      if (tool === undefined) {
        if (requireTools) {
          const message = `${name} not found (run \`task lint-bootstrap\` or \`npm ci\`)`;
          report("precondition", message, `${NAME}: ${message}`);
          status = Math.max(status, 3);
        } else {
          const message = `${name} not found — skipping ${name === "oxlint" ? "lint" : "format"} check.`;
          report("tool-unavailable", message, `${NAME}: ${message}`, "warning");
        }
        continue;
      }
      const code = run(tool, files);
      status = status === 3 || code === 3 ? 3 : Math.max(status, code);
    }
    return finish(status, files);
  }

  process.exitCode = main(process.argv.slice(2));
})();
