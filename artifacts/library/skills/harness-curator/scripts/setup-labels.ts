// setup-labels.ts — Bootstrap the GitHub labels used by the Harness Curator
// (TypeScript port of setup-labels.sh, spec 0258 R14).
//
// Run `node setup-labels.ts --help` for the usage. Self-contained on purpose:
// the component build copies this file byte for byte into built trees and user
// directories, so it imports no file and loads built-ins with
// process.getBuiltinModule (it must run under any package "type").

process.removeAllListeners("warning");

void (async () => {
  const fs = process.getBuiltinModule("node:fs");
  const path = process.getBuiltinModule("node:path");
  const cp = process.getBuiltinModule("node:child_process");
  const isWin = process.platform === "win32";
  const out = (m: string) => process.stdout.write(`${m}\n`);
  const err = (m: string) => process.stderr.write(`${m}\n`);

  // Usage: the header of setup-labels.sh up to `set -euo pipefail`, `# ` prefixes included.
  const USAGE = [
    "# setup-labels.sh — Bootstrap the GitHub labels used by the Harness Curator.",
    "#",
    "# `gh issue create --label <name>` fails if the label does not exist on",
    "# the target repo, so every fork that may receive curator output must",
    "# pre-create the 9 labels listed below before the first `--apply` run.",
    "# This script is the one-shot, idempotent bootstrap maintainers run once",
    "# per target repo (or any time the label vocabulary changes — re-runs",
    "# are safe, see `gh label create --force` semantics).",
    "#",
    "# Usage:",
    "#   bash scripts/setup-labels.sh [--repo <owner/repo>] [--dry-run]",
    "#",
    "# Options:",
    "#   --repo <owner/repo>  Target repo. Omit to let `gh` resolve from the",
    "#                        current working directory's git remote.",
    "#   --dry-run            Print the plan (one line per label) without",
    "#                        contacting GitHub. Exit 0 unless the args are",
    "#                        malformed.",
    "#",
    "# Exit codes:",
    "#   0   All 9 labels created or updated successfully (or dry-run plan",
    "#       printed).",
    "#   1   Usage error.",
    "#   2   One or more `gh label create` calls failed. Every label is",
    "#       attempted before exit — partial failure does not short-circuit.",
    "#",
    "# Idempotence: `gh label create --force` creates the label if absent,",
    "# otherwise updates its color and description in place. Re-running the",
    "# script after a label vocabulary change is the supported upgrade path.",
    "",
  ];
  const usage = () => err(USAGE.join("\n"));

  // Source of truth for the 9 labels the Curator emits: name, colour (6 hex, no #), description.
  const LABELS: [string, string, string][] = [
    ["harness-feedback", "FBCA04", "Auto-curated friction report"],
    ["room:tool", "0E8A16", "Friction category: tool"],
    ["room:prompt", "0E8A16", "Friction category: prompt"],
    ["room:format", "0E8A16", "Friction category: format"],
    ["room:behavior", "0E8A16", "Friction category: behavior"],
    ["room:process", "0E8A16", "Friction category: process"],
    ["severity:low", "C2E0C6", "Friction severity: low"],
    ["severity:med", "FBCA04", "Friction severity: med"],
    ["severity:high", "D93F0B", "Friction severity: high"],
  ];

  /** First executable named `name` on PATH (PATHEXT on Windows); never spawns a lookup tool. */
  const which = (name: string): string | undefined => {
    const lower = name.toLowerCase();
    const pathext = (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean);
    const hasExt = pathext.some((e) => lower.endsWith(e.toLowerCase()));
    const exts = isWin ? (hasExt ? ["", ...pathext] : pathext) : [""];
    const dirs = (process.env.PATH ?? "")
      .split(path.delimiter)
      .map((d) => d.replace(/^"|"$/g, "") || ".");
    for (const d of dirs) {
      for (const e of exts) {
        const f = path.join(d, name + e);
        try {
          if (!fs.statSync(f).isFile()) continue;
          if (!isWin) fs.accessSync(f, fs.constants.X_OK);
          return f;
        } catch {
          // not here
        }
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

  const argv = process.argv.slice(2);
  let repo = "";
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    if (a === "--repo") {
      const v = argv[i + 1];
      if (v === undefined) {
        err("ERROR: --repo requires a value");
        usage();
        process.exitCode = 1;
        return;
      }
      repo = v;
      i++;
    } else if (a === "--dry-run") {
      dryRun = true;
    } else if (a === "-h" || a === "--help") {
      usage();
      return;
    } else {
      err(`ERROR: unknown argument: ${a}`);
      usage();
      process.exitCode = 1;
      return;
    }
  }

  if (dryRun) {
    for (const [name, color, desc] of LABELS)
      out(`would create: ${name} (color=${color}, description=${desc})`);
    return;
  }

  // Per-label `gh label create --force`; every label is attempted before a non-zero exit.
  const gh = which("gh");
  if (gh === undefined) {
    err("ERROR: gh CLI is required but not found in PATH");
    process.exitCode = 1;
    return;
  }
  const failures: string[] = [];
  for (const [name, color, desc] of LABELS) {
    let ok = false;
    try {
      const l = launch(gh, [
        "label",
        "create",
        name,
        "--color",
        color,
        "--description",
        desc,
        "--force",
        ...(repo === "" ? [] : ["--repo", repo]),
      ]);
      ok =
        cp.spawnSync(l.file, l.args, { stdio: "ignore", windowsVerbatimArguments: l.verbatim })
          .status === 0;
    } catch {
      // a refused or failed launch counts as a failed label
    }
    if (ok) out(`ok: ${name}`);
    else {
      err(`FAIL: ${name}`);
      failures.push(name);
    }
  }
  if (failures.length > 0) {
    err("");
    err(`ERROR: ${failures.length} label(s) failed: ${failures.join(" ")}`);
    err("Re-run after resolving (check gh auth status and repo permissions).");
    process.exitCode = 2;
    return;
  }
  out("");
  out(`OK: all ${LABELS.length} labels bootstrapped${repo === "" ? "" : ` on ${repo}`}.`);
})();
