// curate.ts — Harness Curator entry point (TypeScript port of curate.sh, spec 0258 R13).
//
// Run `node curate.ts --help` for the options. Self-contained on purpose: the
// component build copies this file byte for byte into built trees and user
// directories, so it imports no file and loads built-ins with
// process.getBuiltinModule (it must run under any package "type").

process.removeAllListeners("warning");

void (async () => {
  const fs = process.getBuiltinModule("node:fs");
  const os = process.getBuiltinModule("node:os");
  const path = process.getBuiltinModule("node:path");
  const cp = process.getBuiltinModule("node:child_process");
  const crypto = process.getBuiltinModule("node:crypto");
  const isWin = process.platform === "win32";
  const me = process.argv[1] ?? "curate.ts";
  const fail = (code: number, ...lines: string[]) => {
    for (const l of lines) process.stderr.write(`${l}\n`);
    process.exitCode = code;
  };

  // Constant help text: lines 2-44 of curate.sh, `# ` prefixes included.
  const HELP = [
    "# curate.sh — Harness Curator entry point",
    "#",
    '# Reads friction reports from MemPalace `wing="harness-friction"` (or from',
    "# stdin in test mode), clusters them by subcategory/room, composes issue",
    "# bodies, and either prints the result as JSON (`--dry-run`, default) or",
    "# opens one GitHub issue per cluster via `gh` (`--apply`).",
    "#",
    "# V0 is descriptive-only: the artifact opened is an *issue*, not an MR.",
    "# The actual fix (diff) lands later, either human-authored or via the",
    "# auto-fix mode tracked in #42, and closes the issue.",
    "#",
    "# Usage:",
    "#   bash scripts/curate.sh [--dry-run | --apply]",
    "#                          [--from-stdin]",
    "#                          [--target-repo <url>]",
    "#                          [--threshold <n>]",
    "#                          [--max-issues <n>]",
    "#                          [--dedup]",
    "#                          [--deep] [--deep-window <n>]",
    "#",
    "# Options:",
    "#   --dry-run        Output JSON of clusters that would become issues (default).",
    "#   --apply          Open issues via `gh issue create`. Requires gh authenticated.",
    "#   --from-stdin     Read frictions JSON list from stdin instead of MemPalace.",
    "#                    For unit tests and dry-runs without a live wing.",
    "#   --target-repo    Force a single issue target repo (overrides per-friction",
    "#                    provenance routing). For tests / single-fork curation.",
    "#   --threshold      Minimum cluster size to propose an issue (default: 2).",
    "#                    Severity-`high` frictions bypass this and always cluster.",
    "#   --max-issues     Cap the number of clusters emitted in a single run",
    "#                    (default: 0 = unlimited). When the cap fires, clusters",
    "#                    are ranked by severity (high → low), then by cluster",
    "#                    size (desc), then by cluster_key (asc, for stability).",
    "#                    Auto mode uses `--max-issues 5` to bound a sweep.",
    "#   --dedup          Skip clusters whose `cluster_key` already has an open",
    "#                    `harness-feedback` issue on the target repo (matched on",
    '#                    the canonical "Friction cluster: <key> (" title prefix).',
    "#                    Auto mode pairs this with --apply so re-runs are safe.",
    "#   --deep           Deep sweep mode: scan wing=transcripts with heuristic",
    "#                    pre-filtering and emit a Markdown review document",
    "#                    instead of clusters/issues. Incompatible with --apply.",
    "#   --deep-window    Maximum number of transcript drawers to scan in --deep",
    "#                    mode (default: 500).",
  ];

  /** First executable named `name` on PATH (PATHEXT on Windows); never spawns a lookup tool. */
  const which = (name: string): string | undefined => {
    const pathext = (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
    const hasExt = pathext.some((e) => name.toLowerCase().endsWith(e.toLowerCase()));
    const exts = isWin ? (hasExt ? ["", ...pathext] : pathext) : [""];
    const hasSep = name.includes("/") || (isWin && name.includes("\\"));
    const dirs = hasSep
      ? [""]
      : (process.env.PATH ?? "").split(path.delimiter).map((d) => d.replace(/^"|"$/g, "") || ".");
    const usable = (f: string): boolean => {
      try {
        if (!isWin) fs.accessSync(f, fs.constants.X_OK);
        return fs.statSync(f).isFile();
      } catch {
        return false;
      }
    };
    for (const d of dirs) {
      for (const e of exts) {
        const f = d === "" ? name + e : path.join(d, name + e);
        if (usable(f)) return f;
      }
    }
    return undefined;
  };

  /** Argument-array launch; a Windows .cmd/.bat goes through cmd.exe only after refusing its metacharacters. */
  const launch = (file: string, args: string[]) => {
    if (isWin && /\.(cmd|bat)$/i.test(file)) {
      if ([file, ...args].some((a) => /["%^&|<>\r\n]/.test(a)))
        throw new Error(`refusing to launch ${file}: an argument holds a cmd.exe metacharacter`);
      const q = (a: string) => (a === "" || /[\s,;=]/.test(a) ? `"${a}"` : a);
      return {
        file: process.env.ComSpec ?? "cmd.exe",
        args: ["/d", "/s", "/c", `"${[file, ...args].map(q).join(" ")}"`],
        verbatim: true,
      };
    }
    return { file, args, verbatim: false };
  };

  const STDIO = {
    capture: ["inherit", "pipe", "inherit"],
    quiet: ["ignore", "pipe", "ignore"],
    feed: ["pipe", "inherit", "inherit"],
  } as const;
  let child: ReturnType<typeof cp.spawn> | undefined;
  const run = (
    file: string,
    args: string[],
    mode: keyof typeof STDIO,
    env: NodeJS.ProcessEnv,
    input?: string,
  ) =>
    new Promise<{ status: number; out: string }>((resolve, reject) => {
      const l = launch(file, args);
      const stdio = [...STDIO[mode]];
      const c = cp.spawn(l.file, l.args, { stdio, env, windowsVerbatimArguments: l.verbatim });
      child = c;
      const bufs: Buffer[] = [];
      c.stdout?.on("data", (d: Buffer) => bufs.push(d));
      if (input !== undefined) {
        c.stdin?.on("error", () => undefined);
        c.stdin?.end(input);
      }
      c.on("error", reject);
      c.on("close", (code, sig) => {
        const status = code ?? 128 + (sig ? (os.constants.signals[sig] ?? 0) : 0);
        resolve({ status, out: Buffer.concat(bufs).toString("utf8") });
      });
    });

  let tmp = "";
  const cleanup = () => {
    if (tmp !== "") fs.rmSync(tmp, { force: true });
  };
  process.on("exit", cleanup);
  for (const s of ["SIGINT", "SIGTERM"] as const) {
    process.on(s, () => {
      child?.kill(s);
      cleanup();
      process.removeAllListeners(s);
      process.kill(process.pid, s);
    });
  }

  const main = async (): Promise<void> => {
    const argv = process.argv.slice(2);
    let dryRun = true;
    let fromStdin = false;
    let target = "";
    let threshold = "2";
    let maxIssues = "0";
    let dedup = false;
    let deep = false;
    let deepWindow = "500";
    const valued: Record<string, (v: string) => void> = {
      "--target-repo": (v) => (target = v),
      "--threshold": (v) => (threshold = v),
      "--max-issues": (v) => (maxIssues = v),
      "--deep-window": (v) => (deepWindow = v),
    };
    for (let i = 0; i < argv.length; i++) {
      const a = argv[i] ?? "";
      if (a === "--dry-run") dryRun = true;
      else if (a === "--apply") dryRun = false;
      else if (a === "--from-stdin") fromStdin = true;
      else if (a === "--dedup") dedup = true;
      else if (a === "--deep") deep = true;
      else if (a === "--help" || a === "-h") {
        process.stdout.write(`${HELP.join("\n")}\n`);
        return;
      } else if (Object.hasOwn(valued, a)) {
        const v = argv[i + 1];
        if (v === undefined) {
          return fail(1, `Error: ${a} requires a value`, `Run '${me} --help' for usage.`);
        }
        valued[a]?.(v);
        i++;
      } else {
        return fail(1, `Unknown option: ${a}`, `Run '${me} --help' for usage.`);
      }
    }
    if (!/^[0-9]+$/.test(threshold) || Number(threshold) < 1)
      return fail(1, "Error: --threshold must be a positive integer");
    if (!/^[0-9]+$/.test(maxIssues))
      return fail(1, "Error: --max-issues must be a non-negative integer (0 = unlimited)");
    if (deep && !dryRun)
      return fail(
        1,
        "Error: --deep is incompatible with --apply (--deep produces a review document only).",
      );

    // --- Interpreter: MEMPALACE_PYTHON, pipx venv, python3; Windows adds python and `py -3` ---
    const pipx = which("pipx");
    let venvPython: string | undefined;
    if (pipx !== undefined && !process.env.MEMPALACE_PYTHON) {
      let home = "";
      try {
        const r = await run(pipx, ["environment", "--value", "PIPX_HOME"], "quiet", process.env);
        home = r.out.replace(/\n+$/, "");
      } catch {
        // an unusable pipx leaves the home empty, as in the shell
      }
      const venv = `${home}/venvs/mempalace`;
      try {
        if (fs.statSync(venv).isDirectory())
          venvPython = isWin ? `${venv}\\Scripts\\python.exe` : `${venv}/bin/python3`;
      } catch {
        // no pipx venv
      }
    }
    const envPy = process.env.MEMPALACE_PYTHON;
    const primary = envPy ? envPy : (venvPython ?? "python3");
    const cands = [primary];
    if (fromStdin || (isWin && !envPy))
      cands.push("python3", ...(isWin ? ["python", "py -3"] : []));
    let py: { file: string; pre: string[] } | undefined;
    for (const c of cands) {
      const pre = c === "py -3" ? ["-3"] : [];
      const file = which(c === "py -3" ? "py" : c);
      if (file !== undefined) {
        py = { file, pre };
        break;
      }
    }
    if (py === undefined) {
      return fail(
        2,
        `Error: ${fromStdin ? "python3" : primary} not found`,
        "Install MemPalace via pipx: pipx install 'mempalace>=3.6.0,<3.7'",
      );
    }

    // --- Run the curator ---
    if (fromStdin) {
      let data: Buffer = Buffer.alloc(0);
      try {
        data = fs.readFileSync(0);
      } catch {
        // closed or empty stdin reads as empty
      }
      tmp = path.join(os.tmpdir(), `crewrig-curate.${crypto.randomBytes(3).toString("hex")}`);
      fs.writeFileSync(tmp, data, { mode: 0o600, flag: "wx" });
    }
    const dir = path.dirname(fs.realpathSync(me));
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      FRICTION_WING: "harness-friction",
      THRESHOLD: threshold,
      MAX_ISSUES: maxIssues,
      TARGET_REPO_OVERRIDE: target,
      FROM_STDIN_FILE: tmp,
      DEEP_MODE: String(deep),
      DEEP_WINDOW: deepWindow,
      ...(isWin ? { PYTHONUTF8: "1" } : {}),
    };
    const r = await run(py.file, [...py.pre, path.join(dir, "curate.py")], "capture", env);
    if (r.status !== 0) return void (process.exitCode = r.status);
    const out = r.out.replace(/\n+$/, "");
    if (deep || dryRun) return void process.stdout.write(`${out}\n`);

    // --apply: one issue per cluster via apply.py; V0 is descriptive-only (issues, not MRs).
    if (which("gh") === undefined)
      return fail(3, "Error: --apply requires the 'gh' CLI to be installed and authenticated.");
    const applyArgs = [...py.pre, path.join(dir, "apply.py"), ...(dedup ? ["--dedup"] : [])];
    process.exitCode = (await run(py.file, applyArgs, "feed", env, `${out}\n`)).status;
  };

  try {
    await main();
  } catch (e) {
    fail(1, `Error: ${e instanceof Error ? e.message : String(e)}`);
  }
})();
