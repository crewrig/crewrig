// simulate-workflow.ts — dry-run a full workflow locally via `act`, with optional event-payload
// injection. TypeScript entry beside simulate-workflow.sh (spec 0258); same output and exit codes.
//
// Usage: node simulate-workflow.ts <workflow-file> [event-type] [event-payload-json-file] [--json]
//
// --help prints the usage on standard output. --json prints one object {ok, data, findings} on
// standard output (human text goes to standard error) with the exit code the run would have had.
// Its error findings carry the reserved rule ids usage, target-unreadable, tool-failed and
// internal-error; a skipped act or docker is the warning finding tool-missing with exit 0.
//
// Defaults: event-type = push. With no payload file a minimal default payload for the event is
// written to an owner-only temporary file (act-payload.<random>.json), removed on every exit path.
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
  const crypto = process.getBuiltinModule("node:crypto");
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
    onChild?: (child: import("node:child_process").ChildProcess) => void,
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
      onChild?.(child);
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

  let payloadFile = "";
  let interrupted = 0;
  let child: import("node:child_process").ChildProcess | undefined;
  const cleanup = (): void => {
    if (payloadFile === "") return;
    try {
      fs.rmSync(payloadFile, { force: true });
    } catch {
      // nothing left to remove
    }
  };
  process.on("exit", cleanup);
  for (const sig of ["SIGINT", "SIGTERM"] as const)
    process.on(sig, () => {
      interrupted = 128 + (os.constants.signals[sig] ?? 0);
      cleanup();
      child?.kill(sig);
    });

  const defaultPayload = (event: string): string => {
    switch (event) {
      case "push":
        return '{"ref":"refs/heads/main"}';
      case "pull_request":
        return '{"action":"opened","pull_request":{"number":1,"head":{"ref":"feature"},"base":{"ref":"main"}}}';
      case "workflow_dispatch":
        return '{"inputs":{}}';
      case "release":
        return '{"action":"published","release":{"tag_name":"v0.0.0"}}';
      default:
        return "{}";
    }
  };

  const usage = `Usage: ${self} <workflow-file> [event-type] [event-payload-json-file]`;
  if (argv.includes("--help")) {
    process.stdout.write(
      `${usage} [--json]\n\nDry-runs a whole workflow locally with act (default event: push). Without a payload file a minimal\npayload for the event is written to a temporary file and removed on exit. The run is skipped with exit 0 when act, the\ndocker CLI or a reachable Docker daemon is missing. --json prints {ok, data, findings}\non stdout.\nExit codes: 0 ok or skipped, 1 file not found, otherwise the status of act, 2 usage error.\n`,
    );
    return;
  }

  const main = async (): Promise<void> => {
    try {
      const args = argv.filter((a) => a !== "--json");
      if (args.length < 1 || args.length > 3) {
        await err(`${usage}\n`);
        findings.push({
          rule: "usage",
          message: "a workflow file is required, then an optional event type and payload file",
        });
        process.exitCode = 2;
        return;
      }
      const workflow = args[0] ?? "";
      const event = args[1] === undefined || args[1] === "" ? "push" : args[1];
      let payload = args[2] ?? "";

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

      if (payload === "") {
        const name = `act-payload.${crypto.randomBytes(6).toString("hex")}.json`;
        const file = `${os.tmpdir().replace(/[\\/]+$/, "")}${win ? "\\" : "/"}${name}`;
        const fd = fs.openSync(file, "wx", 0o600);
        payloadFile = file;
        try {
          fs.writeSync(fd, `${defaultPayload(event)}\n`);
        } finally {
          fs.closeSync(fd);
        }
        payload = file;
      } else if (stat(payload)?.isFile() !== true) {
        await err(`[FAIL] event payload file not found: ${payload}\n`);
        findings.push({
          rule: "target-unreadable",
          message: `event payload file not found: ${payload}`,
        });
        process.exitCode = 1;
        return;
      }

      if (interrupted !== 0) {
        findings.push({
          rule: "tool-failed",
          message: "interrupted by a signal before act started",
        });
        process.exitCode = interrupted;
        return;
      }
      const cmd = [event, "--workflows", workflow, "--eventpath", payload, "--dryrun"];
      await out(`+ act ${cmd.join(" ")}\n`);
      const res = await run(act, cmd, json ? "pipe" : "inherit", (c) => {
        child = c;
      });
      if (json) await err(res.output);
      if (res.error !== undefined) await err(`${self}: ${res.error.message}\n`);
      ran = true;
      if (res.status !== 0 || interrupted !== 0)
        findings.push({ rule: "tool-failed", message: `act exited with status ${res.status}` });
      process.exitCode = res.status;
    } catch (e) {
      await err(`${self}: ${e instanceof Error ? e.message : String(e)}\n`);
      findings.push({
        rule: "internal-error",
        message: e instanceof Error ? e.message : String(e),
      });
      process.exitCode = 1;
    } finally {
      cleanup();
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
