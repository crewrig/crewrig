// check-rules.ts — flag legacy `only:`/`except:` keys on GitLab CI jobs and a pipeline that declares
// jobs but no top-level `workflow:` with `rules:`.
// Usage: node scripts/check-rules.ts <pipeline-file-or-directory> [--json]
// A text scan: no YAML parser, no live GitLab. Exit codes: 0 no error finding (warnings are listed),
// 1 at least one error finding, 2 usage error, 3 unreadable or missing target.
// Contract: docs/skill-authoring-standard.md (the script contract). Self-contained on purpose: no
// import, built-ins through process.getBuiltinModule.

process.removeAllListeners("warning");

void (() => {
  const fs = process.getBuiltinModule("node:fs");

  const NAME = "check-rules.ts";
  const USAGE = `Usage: node scripts/${NAME} <pipeline-file-or-directory> [--json]

Scans a GitLab CI pipeline as text and reports:
  only-except             one error per job that carries an only: or except: key. rules: replaces
                          both, and a job cannot declare both.
  missing-workflow-rules  an error when the scanned files declare a job and no top-level workflow:
                          with rules:, because a push to a branch with an open merge request then
                          runs two pipelines. A warning instead when an include: is present, since
                          the workflow may come from the included file. No job, no finding.

A job is a top-level key outside the reserved keywords (stages, variables, default, workflow,
include, image, services, cache, before_script, after_script, spec) whose value is a block mapping;
hidden jobs starting with "." count. An only: or except: counts only directly under the job key,
not deeper (under rules:, variables:, needs: or inside a script: block).
The scan follows neither YAML anchors, merge keys (<<:) nor extends:: it reports the template that
carries the key, not each job that inherits it.

Directory mode scans <dir>/.gitlab-ci.yml plus the YAML under <dir>/.gitlab/. Nothing is written
and no network is used.

Options:
  --json   print one JSON object {ok, data, findings} on stdout
  --help   print this text

data: {files, jobs}, the counts scanned, so an empty scan is visible.

Exit codes: 0 no error finding, 1 error finding, 2 usage error, 3 missing or unreadable target.
`;

  interface Finding {
    rule: string;
    message: string;
    path?: string;
    line?: number;
    severity?: "error" | "warning";
  }
  const argv = process.argv.slice(2);
  let json = false;
  const emit = (code: number, data: unknown, findings: Finding[], summary: string): void => {
    if (json) {
      process.stdout.write(`${JSON.stringify({ ok: code === 0, data, findings })}\n`);
      process.stderr.write(`${summary}\n`);
    } else (code >= 2 ? process.stderr : process.stdout).write(`${summary}\n`);
    process.exitCode = code;
  };
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(USAGE);
    return;
  }
  json = argv.includes("--json");
  const usageError = (message: string): void =>
    emit(2, null, [{ rule: "usage", message }], `${NAME}: ${message}\n${USAGE.split("\n")[0]}`);
  const positional: string[] = [];
  for (const raw of argv) {
    if (raw === "--json") continue;
    if (raw.startsWith("-")) return usageError(`unknown option ${raw}`);
    positional.push(raw);
  }
  if (positional.length === 0) return usageError("a pipeline file or directory is required");
  if (positional.length > 1) return usageError("exactly one pipeline file or directory is allowed");
  const target = positional[0] as string;

  const preconditionError = (message: string): void =>
    emit(3, null, [{ rule: "precondition", message, path: target }], `${NAME}: ${message}`);

  const kindOf = (p: string): "dir" | "file" | "none" => {
    try {
      const st = fs.statSync(p);
      return st.isDirectory() ? "dir" : st.isFile() ? "file" : "none";
    } catch {
      return "none";
    }
  };
  const walk = (dir: string, acc: string[]): void => {
    let names: string[];
    try {
      names = fs.readdirSync(dir);
    } catch {
      return;
    }
    for (const n of names.sort()) {
      const p = `${dir}/${n}`;
      const st = fs.lstatSync(p, { throwIfNoEntry: false });
      if (st === undefined) continue;
      if (st.isDirectory()) walk(p, acc);
      else if (st.isFile() && (n.endsWith(".yml") || n.endsWith(".yaml"))) acc.push(p);
    }
  };

  const files: string[] = [];
  const kind = kindOf(target);
  if (kind === "dir") {
    if (kindOf(`${target}/.gitlab-ci.yml`) === "file") files.push(`${target}/.gitlab-ci.yml`);
    const sub = `${target}/.gitlab`;
    if (kindOf(sub) === "dir" && !fs.lstatSync(sub).isSymbolicLink()) walk(sub, files);
  } else if (kind === "file") {
    files.push(target);
  } else return preconditionError(`not a file or directory: ${target}`);

  const RESERVED = new Set([
    "stages",
    "variables",
    "default",
    "workflow",
    "include",
    "image",
    "services",
    "cache",
    "before_script",
    "after_script",
    "spec",
  ]);
  const TOP_KEY = /^("[^"]*"|'[^']*'|[^\s#'"-][^:]*?)\s*:(?:\s+(.*))?$/;

  const findings: Finding[] = [];
  let jobs = 0;
  let hasWorkflowRules = false;
  let hasInclude = false;

  for (const f of files) {
    let text: string;
    try {
      text = fs.readFileSync(f, "utf8") as string;
    } catch (e) {
      return preconditionError(`cannot read ${f}: ${(e as Error).message}`);
    }
    const lines = text.split(/\r?\n/);
    const indentOf = (l: string): number => l.length - l.trimStart().length;
    const blank = (l: string): boolean => l.trim() === "" || l.trimStart().startsWith("#");
    /** First non-blank, non-comment line after index i, or -1. */
    const nextContent = (i: number): number => {
      for (let j = i + 1; j < lines.length; j++) if (!blank(lines[j] as string)) return j;
      return -1;
    };

    lines.forEach((line, i) => {
      if (line.startsWith(" ") || line.startsWith("\t") || blank(line)) return;
      const m = TOP_KEY.exec(line);
      if (m === null) return;
      const key = (m[1] as string).replace(/^["']|["']$/g, "");
      // Strip a trailing comment and a bare anchor so `.t: &anchor` still reads as an empty value.
      const value = (m[2] ?? "")
        .replace(/\s+#.*$/, "")
        .replace(/^&\S+$/, "")
        .trim();
      if (key === "include") hasInclude = true;
      const j = nextContent(i);
      const child = j === -1 ? "" : (lines[j] as string);
      const blockMapping =
        value === "" && j !== -1 && indentOf(child) > 0 && !child.trimStart().startsWith("- ");
      if (key === "workflow" && blockMapping) {
        const ci = indentOf(child);
        for (let k = j; k < lines.length; k++) {
          const l = lines[k] as string;
          if (blank(l)) continue;
          if (indentOf(l) === 0) break;
          if (indentOf(l) === ci && /^rules\s*:/.test(l.trimStart())) hasWorkflowRules = true;
        }
        return;
      }
      if (RESERVED.has(key) || !blockMapping) return;
      jobs += 1;
      const ci = indentOf(child);
      for (let k = j; k < lines.length; k++) {
        const l = lines[k] as string;
        if (blank(l)) continue;
        if (indentOf(l) === 0) break;
        const legacy = /^["']?(only|except)["']?\s*:(?:\s|$)/.exec(l.trimStart());
        if (indentOf(l) === ci && legacy !== null)
          findings.push({
            rule: "only-except",
            message: `job "${key}" uses ${legacy[1]}: at line ${k + 1}; replace it with rules: (only/except is superseded and cannot be mixed with rules:)`,
            path: f,
            line: k + 1,
            severity: "error",
          });
      }
    });
  }

  if (jobs > 0 && !hasWorkflowRules) {
    findings.push({
      rule: "missing-workflow-rules",
      message: hasInclude
        ? "jobs are declared and no top-level workflow:rules is in the scanned files; an include: is present, so confirm the included file sets it"
        : "jobs are declared and there is no top-level workflow:rules; add one so a branch with an open merge request does not run two pipelines",
      path: target,
      severity: hasInclude ? "warning" : "error",
    });
  }
  const errors = findings.filter((x) => x.severity !== "warning").length;
  const lines = findings.map((x) => `${x.path}${x.line ? `:${x.line}` : ""}: ${x.severity} ${x.rule}: ${x.message}`);
  const counts = `${files.length} file(s), ${jobs} job(s) scanned`;
  const summary =
    lines.length === 0
      ? `${NAME}: ${counts}, no finding`
      : `${lines.join("\n")}\n${NAME}: ${counts}, ${errors} error(s), ${findings.length - errors} warning(s)`;
  emit(errors > 0 ? 1 : 0, { files: files.length, jobs }, findings, summary);
})();
