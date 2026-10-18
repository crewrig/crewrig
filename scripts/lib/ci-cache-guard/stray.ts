// stray.ts — the `--stray-scan` mode of ci-cache-guard (spec 0170 delta-01 R10-R14): probe that
// the shell still prints 'command not found', run the command once with stdout and stderr passed
// through byte for byte and captured in memory, then report a stray. Exit 0 or the command's
// status, 70 on a stray after a clean command, 71 when the detector is inactive.
//
// Usage: strayScan(args, self). Finding-line format:
//   ci-cache-guard: stray-scan: STRAY in: <command>   then up to 20 matched lines, indented.

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { fatal } from "../governance/report.ts";
import { atLine, bashPath, NO_BASH } from "./shell.ts";

const PHRASE = "command not found";
/** The shell runs the command on this line of ci-cache-guard.sh (the diagnostic names it). */
const RUN_LINE = 143;

function probeText(bash: string): string {
  const r = spawnSync(bash, ["-c", "crewrig_stray_scan_probe_nonexistent_command"], {
    encoding: "utf8",
  });
  return `${r.stdout ?? ""}${r.stderr ?? ""}`.replace(/\n+$/, "");
}

function matchLines(text: string): string[] {
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines.filter((l) => l.includes(PHRASE));
}

/**
 * The shell's `mktemp -d "${TMPDIR:-/tmp}/stray-scan.XXXXXX"` and its EXIT trap: a scratch
 * directory under TMPDIR exists while the command runs and is removed at exit. The removal only
 * touches the directory this call created, and only after checking it still sits directly under
 * the TMPDIR it was created in.
 */
function withScratch(): { remove: () => void } {
  const parent = path.resolve(process.env["TMPDIR"] || "/tmp");
  const dir = fs.mkdtempSync(path.join(parent, "stray-scan."));
  let done = false;
  const remove = (): void => {
    if (done) return;
    done = true;
    const real = path.resolve(dir);
    if (path.dirname(real) === parent && path.basename(real).startsWith("stray-scan.")) {
      fs.rmSync(real, { recursive: true, force: true });
    }
  };
  for (const [sig, code] of [
    ["SIGINT", 130],
    ["SIGTERM", 143],
    ["SIGHUP", 129],
  ] as const) {
    process.once(sig, () => {
      remove();
      process.exit(code);
    });
  }
  return { remove };
}

export async function strayScan(args: readonly string[], self: string): Promise<number> {
  const bash = bashPath();
  if (bash === null) {
    fatal(NO_BASH);
    return 1;
  }
  const probe = probeText(bash);
  if (!probe.includes(PHRASE)) {
    fatal(
      `ci-cache-guard: stray-scan: detector inactive: the shell did not print '${PHRASE}' for a missing command (got: ${probe === "" ? "<nothing>" : probe}). Retry with LC_ALL=C.`,
    );
    return 71;
  }
  const scratch = withScratch();
  try {
    return await runScan(bash, args, self);
  } finally {
    scratch.remove();
  }
}

async function runScan(bash: string, args: readonly string[], self: string): Promise<number> {
  // Status travels on fd 3; a command that never reaches the echo (an `exit` builtin) leaves it
  // empty and reads as 1, as the shell's missing status file does.
  const body = atLine(RUN_LINE, '"$@" 3>&- && echo 0 >&3 || echo $? >&3');
  const child = spawn(bash, ["-c", body, self, ...args], {
    stdio: ["inherit", "pipe", "pipe", "pipe"],
  });
  const out: Buffer[] = [];
  const err: Buffer[] = [];
  let rc = "";
  child.stdout?.on("data", (c: Buffer) => {
    out.push(c);
    process.stdout.write(c);
  });
  child.stderr?.on("data", (c: Buffer) => {
    err.push(c);
    process.stderr.write(c);
  });
  (child.stdio[3] as NodeJS.ReadableStream).on("data", (c: Buffer) => (rc += c.toString("latin1")));
  const spawnFailed = new Promise<boolean>((resolve) => {
    child.once("error", () => resolve(true));
    child.once("close", () => resolve(false));
  });
  if (await spawnFailed) {
    fatal("ci-cache-guard: stray-scan: bash was not found on PATH");
    return 127;
  }
  const text = rc.replace(/\n+$/, "");
  const status = /^[0-9]+$/.test(text) ? Number(text) : 1;
  const latin = (b: Buffer[]): string => Buffer.concat(b).toString("latin1");
  const matches = [...matchLines(latin(out)), ...matchLines(latin(err))].slice(0, 20);
  if (matches.length === 0) return status;
  const head = Buffer.from(`ci-cache-guard: stray-scan: STRAY in: ${args.join(" ")}\n`);
  const rows = Buffer.from(matches.map((l) => `  ${l}\n`).join(""), "latin1");
  process.stderr.write(Buffer.concat([head, rows]));
  return status !== 0 ? status : 70;
}
