// simulate-job.ts — dry-run a single workflow job locally via `act`. TypeScript entry beside
// simulate-job.sh (spec 0258); same output and exit codes.
//
// Usage: node simulate-job.ts <workflow-file> <job-id> [event-type]
//
// Defaults: event-type = push. Requires `act` and a reachable Docker daemon; when either is
// missing the script exits 0 with an explanatory [SKIP] line — it is not a hard blocker.
//
// Self-contained on purpose: the skill's scripts/ folder is copied out of the checkout, so this
// file imports nothing and loads Node built-ins with process.getBuiltinModule.
process.removeAllListeners("warning");

void (async () => {
  const fs = process.getBuiltinModule("node:fs");
  const cp = process.getBuiltinModule("node:child_process");
  const os = process.getBuiltinModule("node:os");
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
      child.on("error", (e) => done({ status: 127, error: e }));
      child.on("close", (code, signal) =>
        done({ status: code ?? 128 + (signal === null ? 0 : (os.constants.signals[signal] ?? 0)) }),
      );
    });

  try {
    const args = process.argv.slice(2);
    if (args.length < 2 || args.length > 3) {
      await err(`Usage: ${self} <workflow-file> <job-id> [event-type]\n`);
      process.exitCode = 2;
      return;
    }
    const workflow = args[0] ?? "";
    const jobId = args[1] ?? "";
    const event = args[2] === undefined || args[2] === "" ? "push" : args[2];

    if (stat(workflow)?.isFile() !== true) {
      await err(`[FAIL] workflow file not found: ${workflow}\n`);
      process.exitCode = 1;
      return;
    }
    const act = findTool("act");
    if (act === undefined) {
      await out("[SKIP] act not found — install: brew install act\n");
      await out("       act runs GitHub Actions locally inside Docker containers.\n");
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

    const cmd = [event, "--workflows", workflow, "--job", jobId, "--dryrun"];
    await out(`+ act ${cmd.join(" ")}\n`);
    const res = await run(act, cmd, "inherit");
    if (res.error !== undefined) await err(`${self}: ${res.error.message}\n`);
    process.exitCode = res.status;
  } catch (e) {
    await err(`${self}: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 1;
  }
})();
