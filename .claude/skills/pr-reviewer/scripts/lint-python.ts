// lint-python.ts — Python linter for PR review.
// Checks: ruff or flake8 (if available), bare print() in non-test files.
// Usage: node lint-python.ts <file1.py> [file2.py ...]
// Exit 0 = no findings, 1 = findings. Missing both ruff and flake8 degrades
// gracefully (exit 0 with a one-line note on stdout).
// Self-contained on purpose: no import, built-ins through process.getBuiltinModule.

process.removeAllListeners("warning");

void (async () => {
  const fs = process.getBuiltinModule("node:fs");
  const os = process.getBuiltinModule("node:os");
  const path = process.getBuiltinModule("node:path");
  const cp = process.getBuiltinModule("node:child_process");
  const crypto = process.getBuiltinModule("node:crypto");

  const NAME = "lint-python.ts";
  const bin = (s: string): string => Buffer.from(s, "utf8").toString("latin1");
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
    const tmp = path.join(os.tmpdir(), `lint-python.${crypto.randomBytes(6).toString("hex")}`);
    const fd = fs.openSync(tmp, "wx", 0o600);
    try {
      const res = cp.spawnSync(cmd, argv, { stdio: ["inherit", fd, fd], ...opts });
      return { status: res.status ?? 1, out: fs.readFileSync(tmp).toString("latin1") };
    } finally {
      fs.closeSync(fd);
      fs.rmSync(tmp, { force: true });
    }
  }

  const files = process.argv.slice(2);
  if (files.length === 0) {
    say(`${NAME}: no files supplied — nothing to check.\n`);
    return;
  }
  let findings = 0;

  const ruff = findTool("ruff");
  const flake8 = ruff === undefined ? findTool("flake8") : undefined;
  const tool = ruff ?? flake8;
  if (tool === undefined) {
    say(`${NAME}: neither ruff nor flake8 found — skipping static analysis.\n`);
  } else {
    const res = run(tool, ruff === undefined ? files : ["check", ...files]);
    if (res.status !== 0) {
      let end = res.out.length;
      while (end > 0 && res.out[end - 1] === "\n") end--;
      process.stdout.write(Buffer.from(`${res.out.slice(0, end)}\n`, "latin1"));
      findings = 1;
    }
  }

  // Bare print() in non-test files: any path containing `test` (so `tests` too) is skipped.
  for (const file of files) {
    try {
      if (!fs.statSync(file).isFile()) continue;
    } catch {
      continue;
    }
    if (file.includes("test")) continue;
    let text: string;
    try {
      text = fs.readFileSync(file).toString("latin1");
    } catch {
      continue;
    }
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (/^[ \t\n\v\f\r]*print\(/.test(lines[i] as string)) {
        say(`${file}:${i + 1}: bare print() in non-test file\n`);
        findings = 1;
      }
    }
  }

  process.exitCode = findings;
})();
