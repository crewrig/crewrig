// probe-tool.ts — probe whether a tool or a subcommand is available before a test is skipped.
// Usage: node probe-tool.ts <tool> [<subcommand>] [--timeout <seconds>] [--json]
// Runs, in order, `<tool> [<subcommand>] --help` and (without a subcommand) `<tool> --version`,
// directly and never through a shell, then a lookup of the tool on PATH as a precursor only.
// Exit codes: 0 a probe exited 0, 1 the tool is unavailable (the finding quotes the evidence a
// skip rationale needs), 2 usage error, 3 precondition failed (PATH is not set). Writes nothing,
// makes no network call of its own. Self-contained on purpose: no import, built-ins through
// process.getBuiltinModule.

process.removeAllListeners("warning");

void (() => {
  const cp = process.getBuiltinModule("node:child_process");
  const fs = process.getBuiltinModule("node:fs");
  const path = process.getBuiltinModule("node:path");

  const NAME = "probe-tool.ts";
  const USAGE = `Usage: node ${NAME} <tool> [<subcommand>] [--timeout <seconds>] [--json]

Probes a tool before a test that needs it is skipped as "unavailable".

Options:
  --timeout <seconds>  per-probe limit (default 10)
  --json               print one JSON object {ok, data, findings} on stdout
  --help               print this text

Probes, in order, stopping at the first that exits 0:
  1. <tool> [<subcommand>] --help
  2. <tool> --version        (only without a subcommand)
  3. a lookup of <tool> on PATH, reported as a precursor: a binary on PATH can still lack the
     subcommand you need, so it never proves availability.
The tool is run directly, not through a shell.

data: {tool, subcommand, available, probes: [{command, outcome, exit_code, stderr_first_line}]}
  outcome: "ok", "exit <n>", "command not found", "permission denied", "timed out", or for the
  PATH lookup "found" / "not found".
Exit codes: 0 available, 1 unavailable, 2 usage error, 3 precondition failed.
`;

  interface Finding {
    rule: string;
    message: string;
  }
  interface Probe {
    command: string;
    outcome: string;
    exit_code: number | null;
    stderr_first_line: string;
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
  let timeout = 10;
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i] as string;
    if (raw === "--json") continue;
    if (raw.startsWith("-") && raw !== "-") {
      const eq = raw.indexOf("=");
      const key = eq === -1 ? raw : raw.slice(0, eq);
      if (key !== "--timeout") return usageError(`unknown option ${raw}`);
      const value = eq !== -1 ? raw.slice(eq + 1) : argv[++i];
      const n = Number(value);
      if (value === undefined || value === "" || !Number.isFinite(n) || n <= 0)
        return usageError("--timeout needs a positive number of seconds");
      timeout = n;
    } else positional.push(raw);
  }
  if (positional.length === 0 || positional[0] === "") return usageError("a tool name is required");
  if (positional.length > 2) return usageError(`unexpected argument ${positional[2] as string}`);
  const tool = positional[0] as string;
  const subcommand = positional[1] ?? null;
  const bare = !tool.includes("/") && !tool.includes("\\");
  const searchPath = process.env["PATH"] ?? "";
  if (bare && searchPath === "") {
    emit(
      3,
      null,
      [
        {
          rule: "precondition",
          message: "PATH is not set, so a bare tool name cannot be looked up",
        },
      ],
      [`${NAME}: PATH is not set`],
    );
    return;
  }

  const firstLine = (text: string): string =>
    (text.split("\n").find((l) => l.trim() !== "") ?? "").trim().slice(0, 200);
  const probes: Probe[] = [];
  const run = (args: string[]): boolean => {
    const command = [tool, ...args].join(" ");
    const r = cp.spawnSync(tool, args, {
      encoding: "utf8",
      timeout: timeout * 1000,
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 16 * 1024 * 1024,
    });
    const code = (r.error as NodeJS.ErrnoException | undefined)?.code;
    let outcome: string;
    if (code === "ENOENT") outcome = "command not found";
    else if (code === "EACCES") outcome = "permission denied";
    else if (code === "ETIMEDOUT") outcome = "timed out";
    else if (r.error !== undefined) outcome = `error ${code ?? r.error.message}`;
    else outcome = r.status === 0 ? "ok" : `exit ${r.status}`;
    probes.push({
      command,
      outcome,
      exit_code: r.error === undefined ? r.status : null,
      stderr_first_line: firstLine(r.stderr ?? ""),
    });
    return r.error === undefined && r.status === 0;
  };

  let available = run([...(subcommand === null ? [] : [subcommand]), "--help"]);
  if (!available && subcommand === null) available = run(["--version"]);

  if (!available) {
    const extensions =
      process.platform === "win32" ? (process.env["PATHEXT"] ?? ".EXE;.CMD;.BAT").split(";") : [""];
    const candidates = bare
      ? searchPath
          .split(path.delimiter)
          .filter((d) => d !== "")
          .flatMap((d) => extensions.map((e) => path.join(d, tool + e)))
      : [tool];
    const found = candidates.find((c) => {
      try {
        fs.accessSync(c, fs.constants.X_OK);
        return fs.statSync(c).isFile();
      } catch {
        return false;
      }
    });
    probes.push({
      command: bare ? `lookup of ${tool} on PATH` : `lookup of ${tool}`,
      outcome: found === undefined ? "not found" : "found",
      exit_code: null,
      stderr_first_line: "",
    });
  }

  const data = { tool, subcommand, available, probes };
  const findings: Finding[] = [];
  if (!available) {
    const lookup = probes.at(-1) as Probe;
    const ran = probes
      .slice(0, -1)
      .map(
        (p) =>
          `\`${p.command}\` gave ${p.outcome}${p.stderr_first_line === "" ? "" : `, stderr: "${p.stderr_first_line}"`}`,
      )
      .join("; ");
    findings.push({
      rule: "unavailable",
      message:
        `${tool}${subcommand === null ? "" : ` ${subcommand}`} did not answer its discovery probes: ${ran}; the PATH lookup says ${lookup.outcome}. ` +
        "Quote this in the skip rationale. A tool can exist and still exit non-zero on its help flag: run a minimal real invocation with throwaway input before skipping.",
    });
  }
  const lines = probes.map(
    (p) =>
      `${p.outcome.padEnd(18)} ${p.command}${p.stderr_first_line === "" ? "" : `  (${p.stderr_first_line})`}`,
  );
  for (const f of findings) lines.push(`error ${f.rule}: ${f.message}`);
  lines.push(
    `${NAME}: ${tool}${subcommand === null ? "" : ` ${subcommand}`} is ${available ? "available" : "unavailable"}`,
  );
  emit(available ? 0 : 1, data, findings, lines);
})();
