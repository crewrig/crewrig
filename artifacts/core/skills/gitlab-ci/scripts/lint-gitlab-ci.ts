// lint-gitlab-ci.ts — validate a GitLab CI pipeline server-side through `glab ci lint`.
// Usage: node scripts/lint-gitlab-ci.ts [pipeline-file] [--repo <group/project>] [--timeout <seconds>] [--json]
// A read-only query: it makes one network call through the forge's own CLI and writes nothing.
// Exit codes: 0 valid, 1 invalid, 2 usage error, 3 not validated (missing file or binary, timeout,
// authentication or connection failure, run outside a repository, unrecognized output).
// Contract: docs/skill-authoring-standard.md (the script contract). Self-contained on purpose: no
// import, built-ins through process.getBuiltinModule.

process.removeAllListeners("warning");

void (async () => {
  const fs = process.getBuiltinModule("node:fs");
  const cp = process.getBuiltinModule("node:child_process");
  await Promise.resolve();

  const NAME = "lint-gitlab-ci.ts";
  const USAGE = `Usage: node scripts/${NAME} [pipeline-file] [--repo <group/project>] [--timeout <seconds>] [--json]

Asks GitLab whether a pipeline is valid by running \`glab ci lint <file>\`. This is a read-only
network call made through glab, with the credentials glab already holds; the script writes nothing
and reads no token. The file defaults to .gitlab-ci.yml.

Outcomes:
  valid        glab exited 0 and printed "CI/CD YAML is valid".                       exit 0
  invalid      glab printed a line ending "is invalid."; one invalid-config finding
               per error line that follows it.                                         exit 1
  not checked  precondition finding that says the pipeline was NOT validated
               server-side: missing file, missing glab, timeout, authentication
               failure, connection failure, run outside a git repository, or output
               the script does not recognize. Never read it as valid.                  exit 3

Options:
  --repo <group/project>   lint against this project; needed when the working directory is not a
                           GitLab checkout, otherwise glab fails before linting
  --timeout <seconds>      kill glab (and its child processes) after this wait; default 30
  --json                   print one JSON object {ok, data, findings} on stdout
  --help                   print this text

Environment: GLAB_BIN replaces the glab executable (tests and offline runs use a stub).
data: {file, repo, verdict} with verdict "valid" or "invalid".

Exit codes: 0 valid, 1 invalid, 2 usage error, 3 not validated.
`;

  interface Finding {
    rule: string;
    message: string;
    path?: string;
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

  let file: string | undefined;
  let repo: string | undefined;
  let timeoutS = 30;
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i] as string;
    if (raw === "--json") continue;
    const eq = /^--(repo|timeout)=(.*)$/.exec(raw);
    const opt = eq !== null ? `--${eq[1]}` : raw;
    if (opt === "--repo" || opt === "--timeout") {
      const value = eq !== null ? (eq[2] as string) : argv[++i];
      if (value === undefined || value === "") return usageError(`${opt} needs a value`);
      if (opt === "--repo") repo = value;
      else {
        timeoutS = Number(value);
        if (!Number.isFinite(timeoutS) || timeoutS <= 0)
          return usageError("--timeout needs a positive number of seconds");
      }
    } else if (raw.startsWith("-")) return usageError(`unknown option ${raw}`);
    else if (file !== undefined) return usageError("at most one pipeline file is allowed");
    else file = raw;
  }
  const target = file ?? ".gitlab-ci.yml";

  const notValidated = (cause: string, hint = ""): void => {
    const message = `${cause}${hint}; the pipeline ${target} was NOT validated server-side`;
    emit(3, null, [{ rule: "precondition", message, path: target }], `${NAME}: ${message}`);
  };
  try {
    if (!fs.statSync(target).isFile()) throw new Error("not a regular file");
    fs.accessSync(target, fs.constants.R_OK);
  } catch (e) {
    return notValidated(`cannot read the pipeline file ${target} (${(e as Error).message})`);
  }

  const bin = process.env.GLAB_BIN ?? "glab";
  const args = ["ci", "lint", target, ...(repo !== undefined ? ["--repo", repo] : [])];
  interface Run {
    status: number | null;
    stdout: string;
    stderr: string;
    spawnError?: NodeJS.ErrnoException;
    timedOut: boolean;
  }
  // glab runs in its own process group so that a timeout kills it and anything it started.
  const run = (): Promise<Run> =>
    new Promise((resolve) => {
      const res: Run = { status: null, stdout: "", stderr: "", timedOut: false };
      let done = false;
      const child = cp.spawn(bin, args, { detached: true, stdio: ["ignore", "pipe", "pipe"] });
      const finish = (): void => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(res);
      };
      child.stdout.on("data", (d: Buffer) => (res.stdout += d.toString("utf8")));
      child.stderr.on("data", (d: Buffer) => (res.stderr += d.toString("utf8")));
      child.on("error", (e: NodeJS.ErrnoException) => {
        res.spawnError = e;
        finish();
      });
      child.on("close", (code: number | null) => {
        res.status = code;
        finish();
      });
      const timer = setTimeout(() => {
        res.timedOut = true;
        try {
          if (process.platform === "win32" && child.pid !== undefined)
            cp.spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"]);
          else process.kill(-(child.pid as number), "SIGKILL");
        } catch {
          child.kill("SIGKILL");
        }
        child.stdout.destroy();
        child.stderr.destroy();
        // Wait briefly for the exit so the child is reaped before this script ends.
        child.on("exit", finish);
        setTimeout(finish, 2000);
      }, timeoutS * 1000);
    });
  const r = await run();

  if (r.spawnError !== undefined) {
    const e = r.spawnError;
    return notValidated(
      e.code === "ENOENT"
        ? `glab is not installed or not executable (${bin})`
        : `glab could not be started (${e.message})`,
    );
  }
  if (r.timedOut) return notValidated(`glab did not answer within ${timeoutS} seconds (timeout)`);

  const outLines = r.stdout.split(/\r?\n/);
  const invalidAt = outLines.findIndex((l) => /(?:^|\s)is invalid\.$/i.test(l.trim()));
  if (invalidAt !== -1) {
    const errors = outLines
      .slice(invalidAt + 1)
      .map((l) => l.trim())
      .filter((l) => l !== "");
    const texts = errors.length > 0 ? errors : [(outLines[invalidAt] as string).trim()];
    const findings: Finding[] = texts.map((message) => ({
      rule: "invalid-config",
      message,
      path: target,
      severity: "error",
    }));
    const summary = `${findings.map((f) => `${target}: error invalid-config: ${f.message}`).join("\n")}\n${NAME}: ${target} is invalid`;
    return emit(1, { file: target, repo: repo ?? null, verdict: "invalid" }, findings, summary);
  }
  if (r.status === 0 && /ci\/cd yaml is valid/i.test(r.stdout))
    return emit(
      0,
      { file: target, repo: repo ?? null, verdict: "valid" },
      [],
      `${NAME}: ${target} is valid (server-side, glab ci lint)`,
    );

  const text = `${r.stderr} ${r.stdout}`.replace(/\s+/g, " ").trim();
  if (/\b401\b|unauthorized|\b403\b|forbidden/i.test(text))
    return notValidated("authentication failure: glab is not logged in or the token has no access");
  if (
    /no such host|dial tcp|connection refused|connection reset|network is unreachable|no route to host|i\/o timeout|could not resolve/i.test(
      text,
    )
  )
    return notValidated("connection failure: GitLab could not be reached");
  if (/not a git repository/i.test(text))
    return notValidated(
      "glab was run outside a GitLab checkout",
      "; pass --repo <group/project>",
    );
  return notValidated(
    `unrecognized glab output (exit ${r.status}): ${text.slice(0, 200) || "no output"}`,
  );
})();
