// simulate-job.ts — dry-run a single workflow job locally via `act`. TypeScript entry beside
// simulate-job.sh (spec 0258); same output and exit codes.
//
// Usage: node simulate-job.ts <workflow-file> <job-id> [event-type] [--json]
//
// --help prints the usage on standard output. --json prints one object {ok, data, findings} on
// standard output (human text goes to standard error) with the exit code the run would have had.
// Its error findings carry the reserved rule ids usage, target-unreadable, tool-failed and
// internal-error; a skipped act or docker is the warning finding tool-missing with exit 0.
//
// Defaults: event-type = push. Requires `act` and a reachable Docker daemon; when either is
// missing the script exits 0 with an explanatory [SKIP] line — it is not a hard blocker.
//
// Self-contained on purpose: the skill's scripts/ folder is copied out of the checkout, so this
// file imports nothing and loads Node built-ins with process.getBuiltinModule.
process.removeAllListeners("warning");

void (async () => {
  const fs = process.getBuiltinModule("node:fs");
  const argv = process.argv.slice(2);
  const json = argv.includes("--json");
  const findings: { rule: string; message: string; severity?: "warning" }[] = [];
  const miss = (what: string): void => {
    findings.push({
      rule: "tool-missing",
      message: `${what}, the simulation was skipped`,
      severity: "warning",
    });
  };
  let ran = false;
  const cp = process.getBuiltinModule("node:child_process");
  const os = process.getBuiltinModule("node:os");
  const win = process.platform === "win32";
  /** Bytes of a UTF-8 string, held as a latin1 string. */
  const u = (s: string): string => Buffer.from(s, "utf8").toString("latin1");
  const write = (stream: NodeJS.WriteStream, s: string): Promise<void> =>
    new Promise((done) => {
      stream.write(Buffer.from(u(s), "latin1"), () => done());
    });
  const out = (s: string): Promise<void> => write(json ? process.stderr : process.stdout, s);
  const err = (s: string): Promise<void> => write(process.stderr, s);
  const self = (process.argv[1] ?? "").split(/[\\/]/).pop() ?? "";
  const stat = (p: string): import("node:fs").Stats | undefined => {
    try {
      return fs.statSync(p);
    } catch {
      return undefined;
    }
  };

  /** A tool on PATH (PATHEXT on Windows), never through a shell or `which`. */
  const findTool = (tool: string): string | undefined => {
    const exts = win
      ? (process.env["PATHEXT"] ?? ".COM;.EXE;.BAT;.CMD").split(";").filter((e) => e !== "")
      : [""];
    for (const raw of (process.env["PATH"] ?? "").split(win ? ";" : ":")) {
      const dir = win ? raw.replace(/^"|"$/g, "") : raw === "" ? "." : raw;
      if (dir === "") continue;
      for (const ext of exts) {
        const candidate = `${dir.replace(/[\\/]+$/, "")}${win ? "\\" : "/"}${tool}${ext}`;
        if (stat(candidate)?.isFile() !== true) continue;
        try {
          if (!win) fs.accessSync(candidate, fs.constants.X_OK);
          return candidate;
        } catch {
          // not executable: keep looking
        }
      }
    }
    return undefined;
  };

  /** Run a tool with an argument array and no shell; a Windows .cmd/.bat goes through cmd.exe. */
  const run = (
    file: string,
    argv: string[],
    stdio: "inherit" | "ignore" | "pipe",
  ): Promise<{ status: number; error?: Error; output: string }> =>
    new Promise((done) => {
      let cmd = file;
      let list = argv;
      let verbatim = false;
      if (win && /\.(cmd|bat)$/i.test(file)) {
        if ([file, ...argv].some((a) => /["%^&|<>\r\n]/.test(a))) {
          done({
            status: 1,
            error: new Error(`refusing an argument that cmd.exe would interpret`),
            output: "",
          });
          return;
        }
        const quote = (a: string): string => (a === "" || /[ \t]/.test(a) ? `"${a}"` : a);
        cmd = process.env["ComSpec"] ?? "cmd.exe";
        list = ["/d", "/s", "/c", `"${[file, ...argv].map(quote).join(" ")}"`];
        verbatim = true;
      }
      const child = cp.spawn(cmd, list, { stdio, windowsVerbatimArguments: verbatim });
      let output = "";
      child.stdout?.on("data", (d: Buffer) => (output += d.toString("latin1")));
      child.stderr?.on("data", (d: Buffer) => (output += d.toString("latin1")));
      child.on("error", (e) => done({ status: 127, error: e, output }));
      child.on("close", (code, signal) =>
        done({
          status: code ?? 128 + (signal === null ? 0 : (os.constants.signals[signal] ?? 0)),
          output,
        }),
      );
    });

  const usage = `Usage: ${self} <workflow-file> <job-id> [event-type]`;
  if (argv.includes("--help")) {
    process.stdout.write(
      `${usage} [--json]\n\nDry-runs one job locally with act (default event: push). The run is skipped with exit 0 when act, the docker CLI or a reachable\nDocker daemon is missing. --json prints {ok, data, findings} on stdout.\nExit codes: 0 ok or skipped, 1 workflow file not found, otherwise the status of act, 2 usage error.\n`,
    );
    return;
  }

  const main = async (): Promise<void> => {
    try {
      const args = argv.filter((a) => a !== "--json");
      if (args.length < 2 || args.length > 3) {
        await err(`${usage}\n`);
        findings.push({
          rule: "usage",
          message: "a workflow file and a job id are required, then an optional event type",
        });
        process.exitCode = 2;
        return;
      }
      const workflow = args[0] ?? "";
      const jobId = args[1] ?? "";
      const event = args[2] === undefined || args[2] === "" ? "push" : args[2];

      if (stat(workflow)?.isFile() !== true) {
        await err(`[FAIL] workflow file not found: ${workflow}\n`);
        findings.push({
          rule: "target-unreadable",
          message: `workflow file not found: ${workflow}`,
        });
        process.exitCode = 1;
        return;
      }
      const act = findTool("act");
      if (act === undefined) {
        await out("[SKIP] act not found — install: brew install act\n");
        await out("       act runs GitHub Actions locally inside Docker containers.\n");
        miss("act not found (brew install act)");
        return;
      }
      const docker = findTool("docker");
      if (docker === undefined) {
        await out("[SKIP] docker CLI not found — act needs Docker to run containers.\n");
        miss("docker CLI not found");
        return;
      }
      if ((await run(docker, ["info"], "ignore")).status !== 0) {
        await out(
          "[SKIP] Docker daemon not reachable — start Docker Desktop or the docker service.\n",
        );
        miss("Docker daemon not reachable");
        return;
      }

      const cmd = [event, "--workflows", workflow, "--job", jobId, "--dryrun"];
      await out(`+ act ${cmd.join(" ")}\n`);
      const res = await run(act, cmd, json ? "pipe" : "inherit");
      if (json) await err(res.output);
      if (res.error !== undefined) await err(`${self}: ${res.error.message}\n`);
      ran = true;
      if (res.status !== 0)
        findings.push({ rule: "tool-failed", message: `act exited with status ${res.status}` });
      process.exitCode = res.status;
    } catch (e) {
      await err(`${self}: ${e instanceof Error ? e.message : String(e)}\n`);
      findings.push({
        rule: "internal-error",
        message: e instanceof Error ? e.message : String(e),
      });
      process.exitCode = 1;
    }
  };
  await main();
  if (json) {
    const code = typeof process.exitCode === "number" ? process.exitCode : 0;
    process.stdout.write(
      `${JSON.stringify({ ok: code === 0, data: code === 2 ? null : { ran }, findings })}\n`,
    );
  }
})();
