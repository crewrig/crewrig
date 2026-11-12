// lint-markdown.ts — Markdown linter for PR review.
// Checks: markdownlint (if available).
// Usage: node lint-markdown.ts [--json] [--require-tools] [--] <file1.md> [file2.md ...]
// Exit 0 = no finding, 1 = findings, 2 = usage error, 3 = an input is unreadable or, with
// --require-tools, markdownlint is missing. Without --require-tools a missing markdownlint
// degrades gracefully (exit 0 with a one-line note on stdout). With --json it prints one
// {ok, data, findings} object on stdout and the human text on stderr.
// Self-contained on purpose: no import, built-ins through process.getBuiltinModule.

process.removeAllListeners("warning");

void (async () => {
  const fs = process.getBuiltinModule("node:fs");
  const os = process.getBuiltinModule("node:os");
  const path = process.getBuiltinModule("node:path");
  const cp = process.getBuiltinModule("node:child_process");
  const crypto = process.getBuiltinModule("node:crypto");

  const NAME = "lint-markdown.ts";
  const bin = (s: string): string => Buffer.from(s, "utf8").toString("latin1");
  const unbin = (s: string): string => Buffer.from(s, "latin1").toString("utf8");
  const say = (s: string): void => {
    process.stdout.write(Buffer.from(bin(s), "latin1"));
  };

  /** Locate a tool on PATH (honouring PATHEXT on Windows); no shell, no `which`. */
  function findTool(name: string): string | undefined {
    const win = process.platform === "win32";
    const exts = win
      ? (process.env["PATHEXT"] ?? ".COM;.EXE;.BAT;.CMD").split(";").filter((e) => e !== "")
      : [""];
    const names = win && /\.[A-Za-z0-9]+$/.test(name) ? [name] : exts.map((e) => name + e);
    for (const dir of (process.env["PATH"] ?? "").split(path.delimiter)) {
      for (const n of names) {
        const full = `${dir === "" ? "." : dir}${path.sep}${n}`;
        try {
          if (!fs.statSync(full).isFile()) continue;
          if (!win) fs.accessSync(full, fs.constants.X_OK);
          return full;
        } catch {
          // try the next candidate
        }
      }
    }
    return undefined;
  }

  /** Run `tool` once, stdout and stderr merged in arrival order through one shared temp file. */
  function run(tool: string, args: string[]): { status: number; out: string } {
    let cmd = tool;
    let argv = args;
    const opts: { windowsVerbatimArguments?: boolean } = {};
    if (process.platform === "win32" && /\.(cmd|bat)$/i.test(tool)) {
      if ([tool, ...args].some((a) => /["%^&|<>\r\n]/.test(a)))
        return { status: 1, out: `${NAME}: refusing an argument that cmd.exe would interpret.` };
      cmd = process.env["ComSpec"] ?? "cmd.exe";
      const quoted = [tool, ...args].map((a) => (/[ \t]|^$/.test(a) ? `"${a}"` : a));
      argv = ["/d", "/s", "/c", `"${quoted.join(" ")}"`];
      opts.windowsVerbatimArguments = true;
    }
    const tmp = path.join(os.tmpdir(), `lint-markdown.${crypto.randomBytes(6).toString("hex")}`);
    const fd = fs.openSync(tmp, "wx", 0o600);
    try {
      const res = cp.spawnSync(cmd, argv, { stdio: ["inherit", fd, fd], ...opts });
      return { status: res.status ?? 1, out: fs.readFileSync(tmp).toString("latin1") };
    } finally {
      fs.closeSync(fd);
      fs.rmSync(tmp, { force: true });
    }
  }

  interface Finding {
    rule: string;
    message: string;
    severity?: "warning";
  }
  const USAGE =
    "Usage: node lint-markdown.ts [--json] [--require-tools] [--] <file.md>...\n" +
    "  Runs markdownlint on the files. Exit 0 clean, 1 findings, 2 usage error,\n" +
    "  3 unreadable input or (with --require-tools) markdownlint missing.\n";
  const argv = process.argv.slice(2);
  let json = false;
  let requireTools = false;
  let help = false;
  let usageError: string | undefined;
  const files: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a === "--") {
      files.push(...argv.slice(i + 1));
      break;
    }
    if (a === "--json") json = true;
    else if (a === "--require-tools") requireTools = true;
    else if (a === "--help" || a === "-h") help = true;
    else if (a.length > 1 && a.startsWith("-")) usageError ??= `unknown option ${a}`;
    else files.push(a);
  }
  const log = (s: string): void => {
    if (json) process.stderr.write(Buffer.from(bin(s), "latin1"));
    else say(s);
  };
  const finish = (code: number, data: object | null, findings: Finding[]): void => {
    if (json) process.stdout.write(`${JSON.stringify({ ok: code === 0, data, findings })}\n`);
    process.exitCode = code;
  };
  if (help) {
    process.stdout.write(USAGE);
    return;
  }
  if (usageError !== undefined) {
    log(`${NAME}: ${usageError}\n${USAGE}`);
    finish(2, null, [{ rule: "usage", message: usageError }]);
    return;
  }
  if (files.length === 0) {
    log(`${NAME}: no files supplied — nothing to check.\n`);
    finish(0, { files: [] }, []);
    return;
  }
  // every input is checked before anything is linted: an unreadable one wins over a finding
  const unreadable = files.filter((f) => {
    try {
      return !fs.statSync(f).isFile();
    } catch {
      return true;
    }
  });
  if (unreadable.length > 0) {
    for (const f of unreadable) log(`${f}: not a readable regular file\n`);
    finish(
      3,
      null,
      unreadable.map((f) => ({
        rule: "precondition",
        message: `${f}: not a readable regular file`,
      })),
    );
    return;
  }
  const tool = findTool("markdownlint");
  if (tool === undefined) {
    if (requireTools) {
      log(`${NAME}: markdownlint not found — install it or drop --require-tools.\n`);
      finish(3, null, [{ rule: "precondition", message: "markdownlint not found" }]);
      return;
    }
    log(`${NAME}: markdownlint not found — skipping.\n`);
    finish(0, { files }, [
      {
        rule: "tool-unavailable",
        severity: "warning",
        message: "markdownlint not found; the check was skipped",
      },
    ]);
    return;
  }
  const res = run(tool, files);
  if (res.status === 0) {
    finish(0, { files }, []);
    return;
  }
  let end = res.out.length;
  while (end > 0 && res.out[end - 1] === "\n") end--;
  const text = res.out.slice(0, end);
  if (json) process.stderr.write(Buffer.from(`${text}\n`, "latin1"));
  else process.stdout.write(Buffer.from(`${text}\n`, "latin1"));
  finish(
    1,
    { files },
    text.split("\n").map((l) => ({ rule: "markdownlint", message: unbin(l) })),
  );
})();
