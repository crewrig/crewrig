// schedule-curator.ts — TypeScript entry of schedule-curator.sh (spec 0258 requirements 2, 3, 15).
// Registers (or removes) a recurring local job that runs `curate.ts --apply --dedup --max-issues 5`.
// One self-contained file: the only file it loads is the CrewRig service layer, found by walking up
// from its own real path to the first ancestor holding scripts/lib/service/schedule-backend.ts.

process.removeAllListeners("warning");

void (async () => {
  const fs = process.getBuiltinModule("node:fs");
  const os = process.getBuiltinModule("node:os");
  const path = process.getBuiltinModule("node:path");
  const url = process.getBuiltinModule("node:url");
  const cp = process.getBuiltinModule("node:child_process");
  const readline = process.getBuiltinModule("node:readline");
  type Backend = typeof import("../../../../../scripts/lib/service/schedule-backend.ts");
  type Names = typeof import("../../../../../scripts/lib/service/schedule-names.ts");
  type Exec = typeof import("../../../../../scripts/lib/service/exec.ts");

  const HELP =
    [
      "# schedule-curator.sh — Install (or remove) a recurring local schedule that",
      "# runs `curate.sh --apply --dedup --max-issues 5` on the maintainer's",
      "# machine. Auto mode never runs on CI by design: MemPalace state is local.",
      "#",
      "# Usage:",
      "#   bash schedule-curator.sh             # interactive install",
      "#   bash schedule-curator.sh --dry-run   # print the plist / cron line, no install",
      "#   bash schedule-curator.sh --uninstall # remove the managed schedule entry",
      "#",
      "# Idempotency: re-running install replaces the previous entry, never",
      "# duplicates. On macOS the plist lives at",
      "# `~/Library/LaunchAgents/io.crewrig.harness-curator.plist`. On Linux the",
      "# crontab entry is wrapped between a recognizable marker comment.",
      "",
    ].join("\n") + "\n";
  const CRON_NOTE =
    'Note: a crontab entry from an earlier version (marker "# crewrig-harness-curator") is not removed by this command; remove it manually with "crontab -e".';
  const CURATE_ARGS = ["--apply", "--dedup", "--max-issues", "5"];

  const self = process.argv[1] ?? "schedule-curator.ts";
  const out = (line: string): void => void process.stdout.write(`${line}\n`);
  const err = (...lines: string[]): void => {
    for (const line of lines) process.stderr.write(`${line}\n`);
    process.exitCode = 1;
  };

  // --- Arguments (the shell's order: left to right, --help exits at once) ---
  let dryRun = false;
  let uninstall = false;
  let frequency: string | undefined;
  let hourText: string | undefined;
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--uninstall") uninstall = true;
    else if (arg === "--help" || arg === "-h") {
      process.stdout.write(HELP);
      return;
    } else if (arg === "--frequency" || arg === "--hour") {
      const value = argv[++i];
      if (value === undefined) return err(`Error: ${arg} requires a value.`);
      if (arg === "--frequency") {
        if (value !== "weekly" && value !== "daily") {
          return err("Error: --frequency must be 'weekly' or 'daily'.");
        }
        frequency = value;
      } else {
        if (!/^\d{1,2}$/.test(value) || Number(value) > 23) {
          return err("Error: --hour must be an integer from 0 to 23.");
        }
        hourText = value;
      }
    } else return err(`Unknown option: ${arg}`, `Run '${self} --help' for usage.`);
  }

  // --- The service layer, from the enclosing CrewRig checkout (deviation (n)) ---
  let dir = path.dirname(fs.realpathSync(self));
  let svcDir: string | null = null;
  for (;;) {
    const marker = path.join(dir, "scripts", "lib", "service", "schedule-backend.ts");
    if (fs.existsSync(marker)) {
      svcDir = path.dirname(marker);
      break;
    }
    const up = path.dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  if (svcDir === null) {
    return err(
      `Error: schedule-curator needs a CrewRig checkout: no ancestor of ${path.dirname(fs.realpathSync(self))} holds scripts/lib/service/schedule-backend.ts.`,
    );
  }
  const load = async (file: string): Promise<unknown> =>
    import(url.pathToFileURL(path.join(svcDir, file)).href);
  const backendMod = (await load("schedule-backend.ts")) as Backend;
  const namesMod = (await load("schedule-names.ts")) as Names;
  const platform = ((await load("exec.ts")) as Exec).servicePlatform();

  try {
    const OS = { darwin: "Darwin", linux: "Linux", win32: "Windows" }[platform as string];
    if (OS === undefined) {
      return err(
        `Error: unsupported OS '${platform}' — supported systems are macOS (launchd), Linux (systemd user timer) and Windows (Task Scheduler).`,
      );
    }
    const home = os.homedir();
    const names = namesMod.curatorNames();
    const backend = await backendMod.selectScheduleBackend(platform);

    if (uninstall) {
      const result = backend.uninstall(names);
      if (!result.ok) return err(`Error: ${result.reason}`);
      if (result.removedPath !== undefined) out(`Removed: ${result.removedPath}`);
      else if (OS === "Darwin") {
        const plist = path.join(home, "Library", "LaunchAgents", `${names.label}.plist`);
        out(`No managed plist at ${plist} — nothing to remove.`);
      } else if (OS === "Linux") {
        const timer = path.join(home, ".config", "systemd", "user", `${names.unit}.timer`);
        out(`No managed systemd timer at ${timer} — nothing to remove.`);
      } else out(`No managed task ${names.taskPath} — nothing to remove.`);
      if (OS === "Linux") out(CRON_NOTE);
      return;
    }

    // --- Prerequisites: gh on PATH, then gh authenticated ---
    const exts = OS === "Windows" ? (process.env["PATHEXT"] ?? ".EXE;.CMD;.BAT").split(";") : [""];
    let gh: string | null = null;
    for (const entry of (process.env["PATH"] ?? "").split(path.delimiter)) {
      if (entry === "") continue;
      for (const ext of exts) {
        const candidate = path.join(entry, `gh${ext}`);
        try {
          if (fs.statSync(candidate).isFile()) gh ??= candidate;
        } catch {
          // not here
        }
      }
    }
    if (gh === null) {
      return err(
        "Error: 'gh' CLI is required (the scheduled run calls 'gh issue create').",
        "Install: https://cli.github.com/",
      );
    }
    // A Windows .cmd/.bat shim cannot be spawned directly (CVE-2024-27980): it goes through cmd.exe.
    const shim = OS === "Windows" && /\.(cmd|bat)$/i.test(gh);
    const auth = shim
      ? cp.spawnSync(
          process.env["ComSpec"] ?? "cmd.exe",
          ["/d", "/s", "/c", `""${gh}" auth status"`],
          { stdio: "ignore", windowsVerbatimArguments: true },
        )
      : cp.spawnSync(gh, ["auth", "status"], { stdio: "ignore" });
    if (auth.status !== 0) {
      return err("Error: 'gh' is not authenticated. Run 'gh auth login' first.");
    }
    const curate = path.join(path.dirname(path.resolve(self)), "curate.ts");
    if (!fs.existsSync(curate)) return err(`Error: curate.ts not found at ${curate}`);

    const logFile =
      OS === "Darwin"
        ? path.join(home, "Library", "Logs", "crewrig-harness-curator.log")
        : OS === "Linux"
          ? path.join(
              process.env["XDG_STATE_HOME"] || path.join(home, ".local", "state"),
              "crewrig",
              "harness-curator.log",
            )
          : path.join(
              process.env["LOCALAPPDATA"] || path.join(home, "AppData", "Local"),
              "crewrig",
              "harness-curator.log",
            );
    out("====================================================");
    out("  Harness Curator — schedule installer");
    out("====================================================");
    out("");
    out(`Target OS:  ${OS}`);
    out(`Curator:    ${curate}`);
    out(`Logfile:    ${logFile}`);
    out("");

    // --- Schedule: the options, else a prompt on a terminal ---
    if (
      (frequency === undefined || hourText === undefined) &&
      !(process.stdin.isTTY && process.stdout.isTTY)
    ) {
      return err(
        "Error: no terminal to prompt on: pass both --frequency weekly|daily and --hour <0-23>.",
      );
    }
    if (frequency === undefined || hourText === undefined) {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const ask = (question: string): Promise<string | null> =>
        new Promise((resolve) => {
          rl.once("close", () => resolve(null));
          rl.question(question, resolve);
        });
      while (frequency === undefined) {
        const answer = await ask("Run frequency? [weekly/daily] (weekly): ");
        if (answer === null) break;
        const pick = answer.trim() || "weekly";
        if (pick === "weekly" || pick === "daily") frequency = pick;
      }
      while (frequency !== undefined && hourText === undefined) {
        const answer = await ask("Hour of day (0-23) [09]: ");
        if (answer === null) break;
        const pick = answer.trim() || "09";
        if (/^\d{1,2}$/.test(pick) && Number(pick) <= 23) hourText = pick;
      }
      rl.close();
      if (frequency === undefined || hourText === undefined) {
        out("Cancelled.");
        return;
      }
    }

    const spec = {
      frequency: frequency as "weekly" | "daily",
      hour: Number(hourText),
      nodePath: process.execPath,
      entry: curate,
      args: CURATE_ARGS,
      pathValue: process.env["PATH"] ?? "",
      logFile,
    };
    const tail = (): void => {
      out("");
      out("Reactive trigger (run manually when a severity:high friction is filed):");
      out(`    node ${curate} ${CURATE_ARGS.join(" ")}`);
    };

    if (dryRun) {
      const files = backend.render(names, spec);
      for (const file of files) {
        if (OS !== "Darwin") out(`# ${file.label}`);
        process.stdout.write(file.text);
      }
      tail();
      return;
    }

    const probe = backend.probe();
    if (!probe.ok) return err(`Error: ${probe.capability} is unavailable: ${probe.detail}`);
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    const files = backend.render(names, spec);
    const result = backend.install(names, spec);
    if (!result.ok) return err(`Error: ${result.reason}`);
    if (OS !== "Windows") for (const file of files) out(`Wrote: ${file.label}`);
    if (result.detail !== undefined) out(result.detail);
    if (OS === "Linux") out(CRON_NOTE);
    tail();
  } catch (error) {
    err(`Error: ${error instanceof Error ? error.message : String(error)}`);
  }
})();
