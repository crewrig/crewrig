// lint-workflow.ts — validate GitHub Actions workflow files via actionlint. TypeScript entry
// beside lint-workflow.sh (spec 0258); same output and exit codes.
//
// Usage: node lint-workflow.ts <workflow-file-or-directory>
//
// A directory is linted through every .yml/.yaml under <dir>/.github/workflows (else <dir>). When
// actionlint is missing the script exits 0 with a hint — it is not a hard blocker.
//
// Self-contained on purpose: the skill's scripts/ folder is copied out of the checkout, so this
// file imports nothing and loads Node built-ins with process.getBuiltinModule.
process.removeAllListeners("warning");

void (async () => {
  const fs = process.getBuiltinModule("node:fs");
  const cp = process.getBuiltinModule("node:child_process");
  const os = process.getBuiltinModule("node:os");
  const win = process.platform === "win32";
  const tty = process.stdout.isTTY === true;
  const GREEN = tty ? "\u001b[0;32m" : "";
  const RED = tty ? "\u001b[0;31m" : "";
  const YELLOW = tty ? "\u001b[0;33m" : "";
  const RESET = tty ? "\u001b[0m" : "";
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
    if (args.length !== 1) {
      await err(`Usage: ${self} <workflow-file-or-directory>\n`);
      process.exitCode = 2;
      return;
    }
    const target = args[0] ?? "";

    const actionlint = findTool("actionlint");
    if (actionlint === undefined) {
      await out(
        `${YELLOW}[SKIP] actionlint not found — install: brew install actionlint${RESET}\n`,
      );
      return;
    }

    const files: string[] = [];
    if (stat(target)?.isDirectory() === true) {
      const walk = (dir: string): void => {
        let names: string[];
        try {
          names = fs.readdirSync(dir);
        } catch {
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
      let start = `${target}/.github/workflows`;
      if (stat(start)?.isDirectory() !== true) start = target;
      if (fs.lstatSync(start).isDirectory()) walk(start);
      files.sort((a, b) => Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8")));
    } else if (stat(target)?.isFile() === true) {
      files.push(target);
    } else {
      await err(`${RED}[FAIL] not a file or directory: ${target}${RESET}\n`);
      process.exitCode = 1;
      return;
    }

    if (files.length === 0) {
      await out(`${YELLOW}[SKIP] no workflow files found under: ${target}${RESET}\n`);
      return;
    }

    let rc = 0;
    for (const f of files) {
      const res = await run(actionlint, ["-no-color", f], "inherit");
      if (res.error !== undefined && res.status !== 0) await err(`${self}: ${res.error.message}\n`);
      if (res.status === 0) await out(`${GREEN}[OK]${RESET} ${f}\n`);
      else {
        await out(`${RED}[FAIL]${RESET} ${f}\n`);
        rc = 1;
      }
    }
    process.exitCode = rc;
  } catch (e) {
    await err(`${self}: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 1;
  }
})();
