// lint-typescript.ts — TypeScript linter for PR review (spec 0238 R14).
//
// Runs the same Oxlint type-aware pass (R6, R7) and Oxfmt check-mode pass
// (R8) that CI runs, on the *.ts files it is given — CI itself delegates its
// lint and format steps to this script, so both always render the same
// verdict.
//
// Usage: node lint-typescript.ts [--mode lint|format|both] [--require-tools] <file.ts>...
//   Run it from the repository root (Node >= 24; it runs from its .ts source
//   through Node's built-in type stripping). Non-.ts arguments and files under
//   the built-copy trees are ignored.
//
// Tools resolve from ./node_modules/.bin, then PATH. A missing tool degrades
// gracefully (exit 0 plus a one-line note), like the sibling lint-*.sh
// scripts; with --require-tools a missing tool is a wiring fault (exit 2).
// Exit: 0 clean (max-lines warnings never fail), 1 findings, 2 wiring fault.
//
// Self-contained on purpose: build-components.sh copies it verbatim into the
// four built trees, so it must not import anything from scripts/.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

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
  if (existsSync(local)) return local;
  const probe = spawnSync(name, ["--version"], { encoding: "utf8" });
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

function lint(tool: string, files: string[]): number {
  const res = spawnSync(tool, ["--type-aware", "--format=json", ...files], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  const diags = parseReport(res.stdout ?? "");
  if (diags === null) {
    console.log(
      `${NAME}: oxlint produced no report: ${(res.stderr ?? "").trim() || (res.stdout ?? "").trim()}`,
    );
    return 2;
  }
  let status = 0;
  for (const d of diags) {
    const where = d.line === null ? d.filename : `${d.filename}:${d.line}`;
    if (d.severity === "error") {
      console.log(`${NAME}: ${d.code}: ${where}: ${d.message}`);
      status = 1;
    } else {
      console.log(`warning (non-blocking): ${NAME}: ${d.code}: ${where}: ${d.message}`);
    }
  }
  return status;
}

function format(tool: string, files: string[]): number {
  const res = spawnSync(tool, ["--list-different", "--no-error-on-unmatched-pattern", ...files], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.status !== 0 && res.status !== 1) {
    console.log(`${NAME}: oxfmt failed: ${(res.stderr ?? "").trim()}`);
    return 2;
  }
  const listed = new Set(files);
  const unformatted = (res.stdout ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => listed.has(l));
  for (const file of unformatted) {
    console.log(
      `${NAME}: format: ${file}: not formatted as oxfmt formats it; run \`task format-ts:fix\``,
    );
  }
  if (res.status === 1 && unformatted.length === 0) {
    console.log(
      `${NAME}: oxfmt reported unformatted files it did not name: ${(res.stdout ?? "").trim()}`,
    );
  }
  return res.status === 1 ? 1 : 0;
}

function main(argv: string[]): number {
  let mode = "both";
  let requireTools = false;
  const files: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    if (arg === "--require-tools") requireTools = true;
    else if (arg === "--mode") mode = argv[++i] ?? "";
    else if (arg.startsWith("--mode=")) mode = arg.slice("--mode=".length);
    else if (arg.endsWith(".ts") && !BUILT_TREES.some((t) => arg.startsWith(t))) files.push(arg);
  }
  if (!["lint", "format", "both"].includes(mode)) {
    console.log(`${NAME}: unknown --mode '${mode}' (expected lint, format or both)`);
    return 2;
  }
  if (files.length === 0) {
    console.log(`${NAME}: no *.ts files supplied — nothing to check.`);
    return 0;
  }
  let status = 0;
  const steps: Array<[string, (tool: string, f: string[]) => number]> = [];
  if (mode !== "format") steps.push(["oxlint", lint]);
  if (mode !== "lint") steps.push(["oxfmt", format]);
  for (const [name, run] of steps) {
    const tool = resolveTool(name);
    if (tool === undefined) {
      if (requireTools) {
        console.log(`${NAME}: ${name} not found (run \`task lint-bootstrap\` or \`npm ci\`)`);
        status = Math.max(status, 2);
      } else {
        console.log(
          `${NAME}: ${name} not found — skipping ${name === "oxlint" ? "lint" : "format"} check.`,
        );
      }
      continue;
    }
    status = Math.max(status, run(tool, files));
  }
  return status;
}

process.exitCode = main(process.argv.slice(2));
