// plannotator-gate.ts — presence check, invocation and decision mapping of the plannotator backend.
// Usage: node plannotator-gate.ts check [--json]
//        node plannotator-gate.ts run <file> [--json]
//        node plannotator-gate.ts map --exit-code <n> [--stdout-file <path|->] [--json]
// `plannotator` is looked up on PATH and run directly, never through a shell. Exit codes: 0 the
// outcome is approved or changes-requested (data.outcome says which), 1 the outcome is rejected
// (dismissed, non-zero exit, absent or malformed output), 2 usage error, 3 plannotator is not
// available (the caller falls back to the internal backend and tells the user). Writes nothing,
// makes no network call of its own. Self-contained on purpose: no import, built-ins through
// process.getBuiltinModule.

process.removeAllListeners("warning");

void (() => {
  const cp = process.getBuiltinModule("node:child_process");
  const fs = process.getBuiltinModule("node:fs");

  const NAME = "plannotator-gate.ts";
  const USAGE = `Usage: node ${NAME} check | run <file> | map --exit-code <n> [--stdout-file <path|->] [--json]

Drives the plannotator review backend of a validation gate.

Commands:
  check                  run \`plannotator --version\`; exit 3 when it fails
  run <file>             run \`plannotator annotate <file> --gate --json\` and map the result;
                         human review can last long, so start this command detached
  map                    map an already observed result: --exit-code is the process exit status,
                         --stdout-file the captured standard output (\`-\` reads standard input)
Options:
  --json                 print one JSON object {ok, data, findings} on stdout
  --help                 print this text

A decision is complete only when the process exits 0 AND standard output holds one JSON object
with a decision field. Mapping:
  exit 0 + {"decision":"approved"}                  -> approved
  exit 0 + {"decision":"annotated","feedback":"…"}  -> changes-requested, carrying the feedback
  {"decision":"dismissed"}, a non-zero exit, absent or malformed output -> rejected

data: {outcome, feedback?, decision?, exit_code} for run and map; {available, version} for check.
Exit codes: 0 approved or changes-requested, 1 rejected, 2 usage error, 3 plannotator unavailable.
`;

  interface Finding {
    rule: string;
    message: string;
  }
  const argv = process.argv.slice(2);
  let json = false;
  const emit = (code: number, data: unknown, findings: Finding[], lines: string[]): void => {
    const text = `${lines.join("\n")}\n`;
    if (json) {
      process.stdout.write(`${JSON.stringify({ ok: code === 0, data, findings })}\n`);
      process.stderr.write(text);
    } else (code >= 2 ? process.stderr : process.stdout).write(text);
    process.exitCode = code;
  };
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(USAGE);
    return;
  }
  json = argv.includes("--json");
  const usageError = (message: string): void =>
    emit(
      2,
      null,
      [{ rule: "usage", message }],
      [`${NAME}: ${message}`, USAGE.split("\n")[0] as string],
    );

  const positional: string[] = [];
  const opts: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i] as string;
    if (raw === "--json") continue;
    if (raw.startsWith("-") && raw !== "-") {
      const eq = raw.indexOf("=");
      const key = eq === -1 ? raw : raw.slice(0, eq);
      if (key !== "--exit-code" && key !== "--stdout-file")
        return usageError(`unknown option ${raw}`);
      const value = eq !== -1 ? raw.slice(eq + 1) : argv[++i];
      if (value === undefined || value === "") return usageError(`${key} needs a value`);
      opts[key] = value;
    } else positional.push(raw);
  }
  const command = positional[0];
  if (command !== "check" && command !== "run" && command !== "map")
    return usageError("the first argument must be check, run or map");
  const extra = command === "run" ? 2 : 1;
  if (positional.length > extra)
    return usageError(`unexpected argument ${positional[extra] as string}`);
  if (command === "run" && positional.length < 2) return usageError("run needs the file to review");
  if (command !== "map" && Object.keys(opts).length > 0)
    return usageError("options --exit-code and --stdout-file belong to map");

  const unavailable = (why: string): void =>
    emit(
      3,
      { available: false },
      [
        {
          rule: "precondition",
          message: `plannotator is not available (${why}); fall back to the internal backend and tell the user`,
        },
      ],
      [`${NAME}: plannotator unavailable (${why})`],
    );
  const probe = (): { ok: true; version: string } | { ok: false; why: string } => {
    const r = cp.spawnSync("plannotator", ["--version"], {
      encoding: "utf8",
      timeout: 10_000,
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (r.error !== undefined)
      return { ok: false, why: (r.error as NodeJS.ErrnoException).code ?? "error" };
    if (r.status !== 0) return { ok: false, why: `--version exited ${r.status}` };
    return { ok: true, version: (r.stdout ?? "").trim().split("\n")[0] ?? "" };
  };

  const mapResult = (exitCode: number | null, stdout: string): void => {
    const findings: Finding[] = [];
    let outcome = "rejected";
    let feedback: string | undefined;
    let decision: string | undefined;
    if (exitCode !== 0) {
      findings.push({
        rule: "non-zero-exit",
        message: `plannotator exited ${exitCode}; a decision needs exit 0, so the outcome is rejected`,
      });
    } else {
      let parsed: unknown;
      try {
        parsed = JSON.parse(stdout);
      } catch {
        parsed = undefined;
      }
      const obj = parsed as { decision?: unknown; feedback?: unknown } | undefined;
      if (
        obj === undefined ||
        obj === null ||
        typeof obj !== "object" ||
        typeof obj.decision !== "string"
      )
        findings.push({
          rule: "malformed-output",
          message:
            "standard output is not a gate JSON object with a decision field; the outcome is rejected",
        });
      else {
        decision = obj.decision;
        if (decision === "approved") outcome = "approved";
        else if (decision === "annotated") {
          outcome = "changes-requested";
          feedback = typeof obj.feedback === "string" ? obj.feedback : "";
        } else if (decision === "dismissed")
          findings.push({
            rule: "dismissed",
            message: "the reviewer dismissed the gate; the outcome is rejected",
          });
        else
          findings.push({
            rule: "unknown-decision",
            message: `decision ${decision} is not approved, annotated or dismissed; the outcome is rejected`,
          });
      }
    }
    const data = {
      outcome,
      ...(feedback === undefined ? {} : { feedback }),
      ...(decision === undefined ? {} : { decision }),
      exit_code: exitCode,
    };
    const ok = outcome !== "rejected";
    emit(ok ? 0 : 1, data, findings, [
      `outcome=${outcome}`,
      ...(feedback === undefined ? [] : [`feedback=${feedback}`]),
      ...findings.map((f) => `${f.rule}: ${f.message}`),
    ]);
  };

  if (command === "check") {
    const p = probe();
    if (!p.ok) return unavailable(p.why);
    emit(0, { available: true, version: p.version }, [], [`plannotator ${p.version}`]);
    return;
  }
  if (command === "map") {
    const raw = opts["--exit-code"];
    if (raw === undefined || !/^-?\d+$/.test(raw))
      return usageError("map needs --exit-code <integer>");
    let stdout = "";
    const src = opts["--stdout-file"];
    if (src !== undefined) {
      try {
        stdout = fs.readFileSync(src === "-" ? 0 : src, "utf8");
      } catch {
        return emit(
          3,
          null,
          [{ rule: "precondition", message: `cannot read ${src}` }],
          [`${NAME}: cannot read ${src}`],
        );
      }
    }
    return mapResult(Number(raw), stdout);
  }

  const file = positional[1] as string;
  if (!fs.existsSync(file))
    return emit(
      3,
      null,
      [{ rule: "precondition", message: `${file} does not exist` }],
      [`${NAME}: ${file} does not exist`],
    );
  const p = probe();
  if (!p.ok) return unavailable(p.why);
  const r = cp.spawnSync("plannotator", ["annotate", file, "--gate", "--json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error !== undefined) return unavailable((r.error as NodeJS.ErrnoException).code ?? "error");
  mapResult(r.status, r.stdout ?? "");
})();
