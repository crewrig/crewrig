// lint-workflow.ts — validate GitHub Actions workflow files via actionlint. TypeScript entry
// beside lint-workflow.sh (spec 0258); same output and exit codes.
//
// Usage: node lint-workflow.ts <workflow-file-or-directory> [--json]
//
// --help prints the usage on standard output. --json prints one object {ok, data, findings} on
// standard output (human text goes to standard error) with the exit code the run would have had.
// Its error findings carry the reserved rule ids usage, target-unreadable, tool-failed and
// internal-error; a skipped actionlint is the warning finding tool-missing with exit 0.
//
// A directory is linted through every .yml/.yaml under <dir>/.github/workflows (else <dir>). When
// actionlint is missing the script exits 0 with a hint — it is not a hard blocker.
//
// Self-contained on purpose: the skill's scripts/ folder is copied out of the checkout, so this
// file imports nothing and loads Node built-ins with process.getBuiltinModule.
process.removeAllListeners("warning");

void (async () => {
  const fs = process.getBuiltinModule("node:fs");
  const argv = process.argv.slice(2);
  const json = argv.includes("--json");
  interface Finding {
    rule: string;
    message: string;
    path?: string;
    line?: number;
    severity?: "warning";
  }
  const findings: Finding[] = [];
  const checked: string[] = [];
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

  /** Findings of one failed actionlint run: its own lines, or tool-failed when it did not lint. */
  const lintFindings = (
    f: string,
    res: { status: number; error?: Error; output: string },
  ): Finding[] => {
    const reserved = ["usage", "target-unreadable", "tool-failed", "internal-error"];
    const lines: Finding[] = [];
    for (const row of res.output.split("\n")) {
      const m = /^.+?:(\d+):\d+: (.*?)(?: \[([A-Za-z0-9_-]+)\])?$/.exec(row);
      if (m === null || res.status !== 1) continue;
      const rule = m[3] ?? "actionlint";
      lines.push({
        rule: reserved.includes(rule) ? "actionlint" : rule,
        message: m[2] ?? "",
        path: f,
        line: Number(m[1]),
      });
    }
    if (res.status === 1 && lines.length === 0)
      lines.push({ rule: "actionlint", message: "actionlint reported errors", path: f });
    if (res.status !== 1)
      lines.push({
        rule: "tool-failed",
        message: `actionlint did not lint ${f} (status ${res.status}${res.error === undefined ? "" : `: ${res.error.message}`})`,
        path: f,
      });
    return lines;
  };

  const usage = `Usage: ${self} <workflow-file-or-directory>`;
  if (argv.includes("--help")) {
    process.stdout.write(
      `${usage} [--json]\n\nRuns actionlint on every .yml/.yaml under <dir>/.github/workflows (else <dir>) or on one file.\nWithout actionlint the check is skipped with exit 0 before the path is examined,\nso a missing file also exits 0 on such a machine. --json prints {ok, data, findings} on stdout.\nExit codes: 0 clean or skipped, 1 actionlint reported errors or the target is unreadable, 2 usage error.\n`,
    );
    return;
  }

  const main = async (): Promise<void> => {
    try {
      const args = argv.filter((a) => a !== "--json");
      if (args.length !== 1) {
        await err(`${usage}\n`);
        findings.push({
          rule: "usage",
          message: "exactly one workflow file or directory is required",
        });
        process.exitCode = 2;
        return;
      }
      const target = args[0] ?? "";

      const actionlint = findTool("actionlint");
      if (actionlint === undefined) {
        await out(
          `${YELLOW}[SKIP] actionlint not found — install: brew install actionlint${RESET}\n`,
        );
        findings.push({
          rule: "tool-missing",
          message:
            "actionlint not found, the lint was skipped: install it (brew install actionlint)",
          severity: "warning",
        });
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
        findings.push({ rule: "target-unreadable", message: `not a file or directory: ${target}` });
        process.exitCode = 1;
        return;
      }

      if (files.length === 0) {
        await out(`${YELLOW}[SKIP] no workflow files found under: ${target}${RESET}\n`);
        return;
      }

      let rc = 0;
      for (const f of files) {
        checked.push(f);
        const res = await run(actionlint, ["-no-color", f], json ? "pipe" : "inherit");
        if (json) await err(res.output);
        if (res.error !== undefined && res.status !== 0)
          await err(`${self}: ${res.error.message}\n`);
        if (res.status !== 0) findings.push(...lintFindings(f, res));
        if (res.status === 0) await out(`${GREEN}[OK]${RESET} ${f}\n`);
        else {
          await out(`${RED}[FAIL]${RESET} ${f}\n`);
          rc = 1;
        }
      }
      process.exitCode = rc;
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
      `${JSON.stringify({ ok: code === 0, data: code === 2 ? null : { files: checked }, findings })}\n`,
    );
  }
})();
