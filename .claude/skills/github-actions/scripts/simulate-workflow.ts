// simulate-workflow.ts — dry-run a full workflow locally via `act`, with optional event-payload
// injection. TypeScript entry beside simulate-workflow.sh (spec 0258); same output and exit codes.
//
// Usage: node simulate-workflow.ts <workflow-file> [event-type] [event-payload-json-file]
//
// Defaults: event-type = push. With no payload file a minimal default payload for the event is
// written to an owner-only temporary file (act-payload.<random>.json), removed on every exit path.
//
// Self-contained on purpose: the skill's scripts/ folder is copied out of the checkout, so this
// file imports nothing and loads Node built-ins with process.getBuiltinModule.
process.removeAllListeners("warning");

void (async () => {
  const fs = process.getBuiltinModule("node:fs");
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
  const out = (s: string): Promise<void> => write(process.stdout, s);
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
    stdio: "inherit" | "ignore",
    onChild?: (child: import("node:child_process").ChildProcess) => void,
  ): Promise<{ status: number; error?: Error }> =>
    new Promise((done) => {
      let cmd = file;
      let list = argv;
      let verbatim = false;
      if (win && /\.(cmd|bat)$/i.test(file)) {
        if ([file, ...argv].some((a) => /["%^&|<>\r\n]/.test(a))) {
          done({
            status: 1,
            error: new Error(`refusing an argument that cmd.exe would interpret`),
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
      child.on("error", (e) => done({ status: 127, error: e }));
      child.on("close", (code, signal) =>
        done({ status: code ?? 128 + (signal === null ? 0 : (os.constants.signals[signal] ?? 0)) }),
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

  try {
    const args = process.argv.slice(2);
    if (args.length < 1 || args.length > 3) {
      await err(`Usage: ${self} <workflow-file> [event-type] [event-payload-json-file]\n`);
      process.exitCode = 2;
      return;
    }
    const workflow = args[0] ?? "";
    const event = args[1] === undefined || args[1] === "" ? "push" : args[1];
    let payload = args[2] ?? "";

    if (stat(workflow)?.isFile() !== true) {
      await err(`[FAIL] workflow file not found: ${workflow}\n`);
      process.exitCode = 1;
      return;
    }
    const act = findTool("act");
    if (act === undefined) {
      await out("[SKIP] act not found — install: brew install act\n");
      return;
    }
    const docker = findTool("docker");
    if (docker === undefined) {
      await out("[SKIP] docker CLI not found — act needs Docker to run containers.\n");
      return;
    }
    if ((await run(docker, ["info"], "ignore")).status !== 0) {
      await out(
        "[SKIP] Docker daemon not reachable — start Docker Desktop or the docker service.\n",
      );
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
      process.exitCode = 1;
      return;
    }

    if (interrupted !== 0) {
      process.exitCode = interrupted;
      return;
    }
    const cmd = [event, "--workflows", workflow, "--eventpath", payload, "--dryrun"];
    await out(`+ act ${cmd.join(" ")}\n`);
    const res = await run(act, cmd, "inherit", (c) => {
      child = c;
    });
    if (res.error !== undefined) await err(`${self}: ${res.error.message}\n`);
    process.exitCode = res.status;
  } catch (e) {
    await err(`${self}: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 1;
  } finally {
    cleanup();
  }
})();
