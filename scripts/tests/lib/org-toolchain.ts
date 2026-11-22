// org-toolchain.ts — the isolation and inspection helpers of the organization command tests (org-rig.ts): the
// PATH that holds only `node`, `git` and stub `claude`/`agy` (plan of issue #2114, v3-F1: the restricted PATH and
// the temporary HOME, not an answer, keep `setup` away from the host's service manager), the digest of a tree
// (paths, bytes, modes) and the git repositories that play the organization's upstream.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { sha256, type Rig } from "./launcher-rig.ts";

// ------------------------------------------------------------------------- PATH and stub programs

const STUB_SOURCE = `// stub claude / agy: records its arguments and answers the few queries setup makes.
const fs = process.getBuiltinModule("node:fs");
const path = process.getBuiltinModule("node:path");
const name = process.argv[2];
const args = process.argv.slice(3);
const state = path.join(path.dirname(process.argv[1]), "..", "stub-state");
fs.mkdirSync(state, { recursive: true });
fs.appendFileSync(path.join(state, name + ".jsonl"), JSON.stringify({ argv: args }) + "\\n");
const db = path.join(state, name + "-mcp.tsv");
const rows = fs.existsSync(db) ? fs.readFileSync(db, "utf8").split("\\n").filter(Boolean) : [];
if (args[0] === "--version") {
  console.log("2.0.0 (stub)");
} else if (args[0] === "mcp" && args[1] === "list") {
  if (rows.length === 0) console.log("No MCP servers configured.");
  for (const row of rows) console.log(row.split("\\t")[0] + ": " + row.split("\\t")[1] + " - Connected");
} else if (args[0] === "mcp" && args[1] === "add") {
  const rest = args.slice(2).filter((a, i, all) => a !== "--scope" && all[i - 1] !== "--scope");
  fs.appendFileSync(db, rest[0] + "\\t" + rest.slice(1).join(" ") + "\\n");
  console.log("Added " + rest[0]);
}
`;

export interface Toolchain {
  /** The only PATH entries a child sees. */
  readonly pathValue: string;
  /** The directory of the stub programs and their records (`stub-state` beside it). */
  readonly binDir: string;
  /** The argument lists the stub `name` (claude or agy) recorded, oldest first. */
  calls(name: "claude" | "agy"): string[][];
}

/** The path of `git`, resolved on the PATH of the test process. */
function findGit(): string {
  const finder = process.platform === "win32" ? "where" : "which";
  const found = spawnSync(finder, ["git"], { encoding: "utf8" });
  const first = found.stdout.split(/\r?\n/).find((line) => line.trim() !== "");
  if (found.status !== 0 || first === undefined) throw new Error("git is not on the PATH");
  return first.trim();
}

/** A PATH with `node`, `git` and stub `claude`/`agy` only (v3-F1: this, not an answer, keeps setup off the host). */
export function makeToolchain(rig: Rig): Toolchain {
  const binDir = path.join(rig.root, "tool-bin");
  fs.mkdirSync(binDir);
  const stub = path.join(binDir, "stub.js");
  fs.writeFileSync(stub, STUB_SOURCE);
  const git = findGit();
  const entries: string[] = [binDir];
  for (const name of ["claude", "agy"]) {
    if (process.platform === "win32") {
      fs.writeFileSync(
        path.join(binDir, `${name}.cmd`),
        `@"${process.execPath}" "${stub}" ${name} %*\r\n`,
      );
    } else {
      const file = path.join(binDir, name);
      fs.writeFileSync(file, `#!/bin/sh\nexec '${process.execPath}' '${stub}' ${name} "$@"\n`);
      fs.chmodSync(file, 0o755);
    }
  }
  if (process.platform === "win32") {
    entries.push(path.dirname(process.execPath), path.dirname(git));
    const root = process.env["SystemRoot"] ?? "C:\\Windows";
    entries.push(path.join(root, "System32"));
  } else {
    for (const [name, target] of [
      ["node", process.execPath],
      ["git", git],
    ] as const) {
      const file = path.join(binDir, name);
      fs.writeFileSync(file, `#!/bin/sh\nexec '${target}' "$@"\n`);
      fs.chmodSync(file, 0o755);
    }
  }
  const state = path.join(rig.root, "stub-state");
  return {
    pathValue: entries.join(path.delimiter),
    binDir,
    calls(name) {
      const file = path.join(state, `${name}.jsonl`);
      if (!fs.existsSync(file)) return [];
      return fs
        .readFileSync(file, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => (JSON.parse(line) as { argv: string[] }).argv);
    },
  };
}

// ----------------------------------------------------------------------------- tree digest

/** The digest of a tree: every path, every file's bytes and every mode (links by target), in byte order. */
export function treeDigest(root: string): string {
  const hash = createHash("sha256");
  const walk = (rel: string): void => {
    const names = fs
      .readdirSync(path.join(root, rel))
      .sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
    for (const name of names) {
      const child = rel === "" ? name : `${rel}/${name}`;
      const full = path.join(root, child);
      const stat = fs.lstatSync(full);
      if (stat.isSymbolicLink()) hash.update(`L ${child} ${fs.readlinkSync(full)}\n`);
      else if (stat.isDirectory()) {
        hash.update(`D ${child} ${(stat.mode & 0o777).toString(8)}\n`);
        walk(child);
      } else {
        hash.update(
          `F ${child} ${(stat.mode & 0o777).toString(8)} ${sha256(fs.readFileSync(full))}\n`,
        );
      }
    }
  };
  walk("");
  return hash.digest("hex");
}

// ------------------------------------------------------------------------------------ git helpers

/** Run git with the rig's scrubbed environment and a fixed identity; throws on failure. */
export function gitIn(rig: Rig, cwd: string, args: readonly string[]): string {
  const run = spawnSync(
    "git",
    [
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.invalid",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    { cwd, env: rig.env(), encoding: "utf8" },
  );
  if (run.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${run.stderr}`);
  return run.stdout.trim();
}

/** `git status --porcelain --ignored`-free view of the work tree: what the clone's `git status` would list. */
export function porcelain(rig: Rig, dir: string): string {
  return gitIn(rig, dir, ["status", "--porcelain"]);
}

// ---------------------------------------------------------------------------------- git upstream

export interface Upstream {
  /** The bare repository that plays the organization's remote. */
  readonly bare: string;
  /** A clone the author commits from. */
  readonly author: string;
  /** A user's clone: setup and update run here. */
  readonly clone: string;
  /** Commit all changes of the author's clone and push. */
  publish(message: string): void;
  /** Make the same change reachable from the clone's `git pull`. */
  gitClone(name: string): string;
}

/** Commit `dir` (an organization directory) as the first commit of a bare upstream, then clone it. */
export function withUpstream(rig: Rig, dir: string): Upstream {
  const bare = rig.newDir("upstream") + path.sep + "org.git";
  fs.mkdirSync(bare);
  gitIn(rig, bare, ["init", "-q", "--bare", "-b", "main"]);
  gitIn(rig, dir, ["init", "-q", "-b", "main"]);
  gitIn(rig, dir, ["add", "-A"]);
  gitIn(rig, dir, ["commit", "-q", "-m", "organization"]);
  gitIn(rig, dir, ["remote", "add", "origin", bare]);
  gitIn(rig, dir, ["push", "-q", "-u", "origin", "main"]);
  const gitClone = (name: string): string => {
    const target = rig.newDir(name);
    fs.rmSync(target, { recursive: true });
    gitIn(rig, rig.root, ["clone", "-q", bare, target]);
    return target;
  };
  const clone = gitClone("clone");
  return {
    bare,
    author: dir,
    clone,
    publish(message) {
      gitIn(rig, dir, ["add", "-A"]);
      gitIn(rig, dir, ["commit", "-q", "-m", message]);
      gitIn(rig, dir, ["push", "-q", "origin", "main"]);
    },
    gitClone,
  };
}

// -------------------------------------------------------------------- the host's service manager

/**
 * The CrewRig and MemPalace entries of the host's service manager (launchd, systemd user units, the Task
 * Scheduler), as lines. A run that leaves a unit, a task or a daemon on the host changes this list. When the
 * manager cannot be queried the list is the single line `unavailable`, the same before and after.
 */
export function hostServices(): string[] {
  const query = (command: string, args: readonly string[]): string[] | undefined => {
    const run = spawnSync(command, [...args], { encoding: "utf8", timeout: 20_000 });
    if (run.error !== undefined || run.status !== 0) return undefined;
    return run.stdout.split(/\r?\n/).filter((line) => /crewrig|mempalace/i.test(line));
  };
  const lines =
    process.platform === "darwin"
      ? query("/bin/launchctl", ["list"])
      : process.platform === "win32"
        ? query("schtasks", ["/Query", "/FO", "LIST"])
        : query("systemctl", ["--user", "list-units", "--all", "--no-legend", "--no-pager"]);
  return lines === undefined ? ["unavailable"] : lines.sort();
}

/** Paths under a home that only an installed daemon, unit or task would create. */
export function daemonFilesUnder(entries: readonly string[]): string[] {
  // The MCP daemon launcher's bundle is the daemon's program; the trust wrapper's bundle (win32 installs it for every
  // stdio entry, spec 0256 deviation (m)) shares the same service-lib/ name but is no daemon, so only the launcher's
  // members make that directory a daemon's.
  const launcher = /(^|\/)service-lib\/(launcher-wait|launcher-token)\.ts$/;
  return entries.filter(
    (entry) =>
      !entry.startsWith(".crewrig/versions/") &&
      (/(^|\/)(LaunchAgents|systemd|\.mempalace|service|mcp-daemon-launcher[^/]*)(\/|$)/.test(
        entry,
      ) ||
        launcher.test(entry)),
  );
}

/**
 * Whether settings text names `<version>/hooks/<name>` under a cached version. Separators, the letter case and the
 * 8.3 short names of a Windows path do not count: a hook written with forward slashes names the same file.
 */
export function namesHook(settings: string, version: string, name: string): boolean {
  const text = settings.replaceAll("\\\\", "/").replaceAll("\\", "/").toLowerCase();
  return text.includes(`versions/${version}/hooks/${name}`.toLowerCase());
}
