// validate-pipeline.ts — run the skill's six workflow checks on one workflow file or directory and
// report which ran, which were skipped and which failed.
// Usage: node scripts/validate-pipeline.ts <workflow-file-or-directory> [--json]
// Exit codes: 0 every check ran clean or was skipped, 1 a check that ran reported an error finding,
// 2 usage error or no workflow file, 3 unreadable input or a check that failed to run.
// Writes nothing, makes no network call. Contract: docs/skill-authoring-standard.md (the script
// contract). Self-contained on purpose: no import, built-ins through process.getBuiltinModule.

process.removeAllListeners("warning");

void (() => {
  const fs = process.getBuiltinModule("node:fs");
  const cp = process.getBuiltinModule("node:child_process");
  const path = process.getBuiltinModule("node:path");
  const NAME = "validate-pipeline.ts";
  const USAGE = `Usage: node scripts/${NAME} <workflow-file-or-directory> [--json]

Runs lint-workflow.ts, check-pinned-actions.ts, check-permissions.ts, check-pull-request-target.ts,
check-expression-injection.ts and check-secrets-exposure.ts, from this script's own directory, once
per workflow file, and reports each check as ran (passed, or with findings), skipped (script absent
or external tool missing, with the reason) or failed (it could not run). A skipped check was NOT
verified: say so. A directory is walked recursively from <dir>/.github/workflows when that exists,
else from <dir>, for *.yml and *.yaml files. Exactly one input; "-" is refused because the legacy
checks cannot read standard input: write the workflow to a file first.

Options: --json (one object {ok, data, findings} on stdout), --help (this text).
data: {target, files, checks: [{check, status, result, findings}]}.
Exit codes: 0 every check ran clean or was skipped, 1 an error finding from a check that ran,
2 usage error or no workflow file, 3 unreadable input or a check that failed to run.
`;

  interface Finding {
    rule: string;
    message: string;
    path?: string;
    line?: number;
    severity?: "error" | "warning";
    check?: string;
  }
  const argv = process.argv.slice(2);
  let json = false;
  const emit = (code: number, data: unknown, findings: Finding[], lines: string[]): void => {
    if (json) process.stdout.write(`${JSON.stringify({ ok: code === 0, data, findings })}\n`);
    (json || code >= 2 ? process.stderr : process.stdout).write(`${lines.join("\n")}\n`);
    process.exitCode = code;
  };
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(USAGE);
    return;
  }
  json = argv.includes("--json");
  const fail = (code: number, rule: string, message: string, line: string): void =>
    emit(code, null, [{ rule, message }], [line]);
  const usageError = (message: string): void =>
    fail(2, "usage", message, `${NAME}: ${message}\n${USAGE.split("\n")[0]}`);

  const inputs: string[] = [];
  for (const a of argv) {
    if (a === "--json") continue;
    if (a === "-")
      return usageError(
        "- (standard input) is refused: the legacy checks cannot read it, write the workflow to a file first",
      );
    if (a.startsWith("-")) return usageError(`unknown option ${a}`);
    inputs.push(a);
  }
  if (inputs.length !== 1) return usageError("exactly one workflow file or directory is required");
  const target = inputs[0] as string;

  // Target validity first: no check runs and no tool is looked for before this passes.
  const stat = (p: string): import("node:fs").Stats | undefined => {
    try {
      return fs.statSync(p);
    } catch {
      return undefined;
    }
  };
  const files: string[] = [];
  let unreadable: string | undefined;
  if (stat(target)?.isDirectory() === true) {
    const walk = (dir: string): void => {
      let names: string[];
      try {
        names = fs.readdirSync(dir);
      } catch {
        unreadable ??= dir;
        return;
      }
      for (const n of names) {
        const p = dir.endsWith("/") ? dir + n : `${dir}/${n}`;
        let st: import("node:fs").Stats;
        try {
          st = fs.lstatSync(p);
        } catch {
          continue;
        }
        if (st.isDirectory()) walk(p);
        else if (st.isFile() && /\.ya?ml$/.test(n)) files.push(p);
      }
    };
    const inner = `${target}/.github/workflows`;
    walk(stat(inner)?.isDirectory() === true ? inner : target);
    if (unreadable !== undefined)
      return fail(
        3,
        "precondition",
        `cannot read ${unreadable}`,
        `[FAIL] not readable: ${unreadable}`,
      );
    files.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
    if (files.length === 0)
      return fail(
        2,
        "usage",
        `no workflow file under ${target}`,
        `[FAIL] no workflow files found under: ${target}`,
      );
  } else if (stat(target)?.isFile() === true) files.push(target);
  else
    return fail(
      3,
      "precondition",
      `${target} is not a readable file or directory`,
      `[FAIL] not a file or directory: ${target}`,
    );
  // Every resolved file must be readable before any check runs or any tool is looked for.
  for (const f of files) {
    try {
      fs.accessSync(f, fs.constants.R_OK);
    } catch {
      return fail(3, "precondition", `cannot read ${f}`, `[FAIL] not readable: ${f}`);
    }
  }

  // --- the six checks ----------------------------------------------------------------------------
  const here = path.dirname(path.resolve(process.argv[1] ?? "."));
  const RESERVED = ["usage", "target-unreadable", "tool-failed", "internal-error"];
  type Mode = "new" | "legacy" | "secrets";
  const CHECKS: { script: string; mode: Mode }[] = [
    { script: "lint-workflow.ts", mode: "legacy" },
    { script: "check-pinned-actions.ts", mode: "legacy" },
    { script: "check-permissions.ts", mode: "new" },
    { script: "check-pull-request-target.ts", mode: "new" },
    { script: "check-expression-injection.ts", mode: "new" },
    { script: "check-secrets-exposure.ts", mode: "secrets" },
  ];
  interface Outcome {
    status: "ran" | "skipped" | "failed";
    result: "passed" | "findings" | null;
    reason?: string;
    findings: Finding[];
  }
  const parse = (text: string): Finding[] | undefined => {
    try {
      const obj = JSON.parse(text) as { findings?: Finding[] };
      return Array.isArray(obj.findings) ? obj.findings : undefined;
    } catch {
      return undefined;
    }
  };
  /** One check on one file; the exit code and, for all but the secrets check, the --json object. */
  const runOne = (script: string, mode: Mode, file: string): Outcome => {
    const argvOne = [path.join(here, script), file, ...(mode === "secrets" ? [] : ["--json"])];
    const res = cp.spawnSync(process.execPath, argvOne, { encoding: "utf8", maxBuffer: 1 << 26 });
    const failed = (reason: string): Outcome => ({
      status: "failed",
      result: null,
      reason,
      findings: [],
    });
    if (res.error !== undefined) return failed(`could not start: ${res.error.message}`);
    if (res.status === null) return failed(`killed by ${res.signal ?? "a signal"}`);
    if (mode === "secrets") {
      if (res.status === 0) return { status: "ran", result: "passed", findings: [] };
      if (res.status !== 1) return failed(`exit status ${res.status}`);
      const text = `${res.stdout}${res.stderr}`.trimEnd();
      return {
        status: "ran",
        result: "findings",
        findings: [{ rule: "secrets-exposure", message: text, path: file, severity: "error" }],
      };
    }
    const found = parse(res.stdout);
    if (mode === "legacy") {
      if (found === undefined) return failed(`exit status ${res.status} and no JSON object`);
      const reserved = found.find((f) => RESERVED.includes(f.rule));
      if (reserved !== undefined) return failed(`${reserved.rule}: ${reserved.message}`);
      const missing = found.find((f) => f.rule === "tool-missing");
      if (res.status === 0 && missing !== undefined)
        return { status: "skipped", result: null, reason: missing.message, findings: [] };
    }
    if (res.status !== 0 && res.status !== 1) return failed(`exit status ${res.status}`);
    const errs = (found ?? []).filter((f) => f.severity !== "warning");
    if (res.status === 0) return { status: "ran", result: "passed", findings: found ?? [] };
    return {
      status: "ran",
      result: "findings",
      findings:
        errs.length > 0
          ? (found ?? [])
          : [{ rule: script, message: "reported an error", path: file }],
    };
  };

  const report: Finding[] = [];
  const data: {
    check: string;
    status: string;
    result: string | null;
    findings: number;
    reason?: string;
  }[] = [];
  const lines: string[] = [];
  let hasErrors = false;
  let hasFailed = false;
  for (const { script, mode } of CHECKS) {
    if (!fs.existsSync(path.join(here, script))) {
      data.push({
        check: script,
        status: "skipped",
        result: null,
        findings: 0,
        reason: "the check script is absent",
      });
      lines.push(`[skipped] ${script}: the check script is absent`);
      report.push({
        rule: "check-skipped",
        message: `${script} is absent, so that check was not run`,
        severity: "warning",
        check: script,
      });
      continue;
    }
    const outcomes = files.map((f) => runOne(script, mode, f));
    const bad = outcomes.find((o) => o.status === "failed");
    const ran = outcomes.filter((o) => o.status === "ran");
    const own = outcomes.flatMap((o, i) =>
      o.findings.map((f) => ({ ...f, path: f.path ?? files[i], check: script })),
    );
    if (bad !== undefined) {
      hasFailed = true;
      data.push({ check: script, status: "failed", result: null, findings: 0, reason: bad.reason });
      lines.push(`[failed] ${script}: ${bad.reason ?? "did not run"}`);
      report.push({
        rule: "check-failed",
        message: `${script} failed to run: ${bad.reason ?? ""}`,
        severity: "error",
        check: script,
      });
    } else if (ran.length === 0) {
      const reason = outcomes[0]?.reason ?? "skipped";
      data.push({ check: script, status: "skipped", result: null, findings: 0, reason });
      lines.push(`[skipped] ${script}: ${reason}`);
      report.push({
        rule: "check-skipped",
        message: `${script} was not run: ${reason}`,
        severity: "warning",
        check: script,
      });
    } else {
      const withFindings = ran.some((o) => o.result === "findings");
      const errors = own.filter((f) => f.severity !== "warning").length;
      hasErrors ||= withFindings;
      data.push({
        check: script,
        status: "ran",
        result: withFindings ? "findings" : "passed",
        findings: own.length,
      });
      lines.push(
        `[ran] ${script}: ${withFindings ? `${errors} error finding(s)` : "passed"}${own.length > errors && !withFindings ? ` (${own.length} warning(s))` : ""}`,
      );
      for (const f of own)
        lines.push(
          `      ${f.path ?? ""}${f.line === undefined ? "" : `:${f.line}`}: ${f.rule}: ${f.message}`,
        );
      report.push(...own);
    }
  }
  const count = (s: string): number => data.filter((d) => d.status === s).length;
  lines.push(
    `${files.length} file(s), ${count("ran")} check(s) ran (${data.filter((d) => d.result === "findings").length} with error findings), ${count("skipped")} skipped, ${count("failed")} could not run`,
  );
  emit(hasFailed ? 3 : hasErrors ? 1 : 0, { target, files, checks: data }, report, lines);
})();
