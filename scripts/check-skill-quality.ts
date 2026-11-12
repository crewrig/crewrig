// check-skill-quality.ts — lint the skill sources against the authoring standard
// (spec 0293 R17, R18; docs/skill-authoring-standard.md).
//
// Usage: node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/check-skill-quality.ts
//          [<skill>...] [--json] [--strict] [--help]
// With no skill name, every skill under artifacts/*/skills/ is checked. `CREWRIG_REPO_DIR`
// overrides the repository root (default: this repository).
//
// A skill that ships evals/evals.json is protected: its findings are errors. On any other
// skill a finding is a warning. `--strict` makes every warning an error.
// Output: `--json` prints one object `{ok, data, findings}` on stdout and the human text on
// stderr; without it the human text goes to stdout.
// Exit: 0 no error finding, 1 at least one error finding, 2 usage error (unknown option or
// skill), 3 precondition failure (`js-yaml` missing, repository root not found).
// Finding lines: `ERROR|WARN <file>[:<line>] [<rule>] <message>`.

import fs from "node:fs";
import path from "node:path";

import { repoRootFrom } from "./lib/paths.ts";
import { MissingDependencyError, loadDependency } from "./lib/require-dependency.ts";
import { discover, formatFinding, lintSkills } from "./lib/skill-quality/run.ts";
import type { Finding, YamlNamespace } from "./lib/skill-quality/types.ts";

const USAGE = `Usage: check-skill-quality.ts [<skill>...] [--json] [--strict] [--help]

Lint skill sources against the authoring standard. With no skill name, every skill under
artifacts/*/skills/ is checked. A skill that ships evals/evals.json is protected: its findings
are errors; any other skill only warns. --strict makes every warning an error.

  --json     print one {ok, data, findings} object on stdout, human text on stderr
  --strict   treat warnings as errors
  --help     print this usage and exit 0

Exit: 0 no error, 1 an error finding, 2 usage error, 3 precondition failure.
`;

interface Args {
  names: string[];
  json: boolean;
  strict: boolean;
  help: boolean;
  bad?: string;
}

function parse(argv: readonly string[]): Args {
  const a: Args = { names: [], json: false, strict: false, help: false };
  for (const arg of argv) {
    if (arg === "--json") a.json = true;
    else if (arg === "--strict") a.strict = true;
    else if (arg === "--help" || arg === "-h") a.help = true;
    else if (arg.startsWith("-")) a.bad ??= `unknown option ${arg}`;
    else a.names.push(arg);
  }
  return a;
}

function emit(
  args: Args,
  ok: boolean,
  data: unknown,
  findings: readonly unknown[],
  text: string,
): void {
  if (args.json) {
    process.stdout.write(`${JSON.stringify({ ok, data, findings })}\n`);
    if (text !== "") process.stderr.write(`${text}\n`);
  } else if (text !== "") {
    (data === null ? process.stderr : process.stdout).write(`${text}\n`);
  }
}

function failure(args: Args, code: 2 | 3, rule: "usage" | "precondition", message: string): void {
  emit(args, false, null, [{ rule, message, severity: "error" }], message);
  process.exitCode = code;
}

const args = parse(process.argv.slice(2));
if (args.help) {
  process.stdout.write(USAGE);
} else if (args.bad !== undefined) {
  failure(args, 2, "usage", `${args.bad}\n${USAGE}`.trimEnd());
} else {
  const env = process.env["CREWRIG_REPO_DIR"];
  let repo = "";
  try {
    repo = env !== undefined && env !== "" ? env : path.resolve(repoRootFrom(import.meta.url));
    if (!fs.existsSync(path.join(repo, "artifacts")))
      throw new Error(`no artifacts/ directory in ${repo}`);
  } catch (err) {
    failure(args, 3, "precondition", `repository root not found: ${(err as Error).message}`);
  }
  if (process.exitCode === undefined) {
    try {
      const yaml = (await loadDependency("js-yaml")) as YamlNamespace;
      const all = discover(repo);
      const wanted = args.names.map((n) => all.find((s) => s.name === n || s.rel === n));
      const unknown = args.names.filter((_, i) => wanted[i] === undefined);
      if (unknown.length > 0) {
        failure(
          args,
          2,
          "usage",
          `unknown skill ${unknown.join(", ")}; known: ${all.map((s) => s.name).join(", ")}`,
        );
      } else {
        const chosen = args.names.length === 0 ? all : wanted.filter((s) => s !== undefined);
        const { findings, skills } = lintSkills(repo, yaml, chosen, args.strict);
        const errors = findings.filter((f: Finding) => f.severity === "error").length;
        const warnings = findings.length - errors;
        const summary = `${skills.length} skill(s) checked: ${errors} error(s), ${warnings} warning(s)`;
        const text = [...findings.map(formatFinding), summary].join("\n");
        emit(args, errors === 0, { skills, errors, warnings }, findings, text);
        if (errors > 0) process.exitCode = 1;
      }
    } catch (err) {
      if (!(err instanceof MissingDependencyError)) throw err;
      failure(args, 3, "precondition", err.message);
    }
  }
}
