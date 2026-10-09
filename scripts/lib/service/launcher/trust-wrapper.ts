// trust-wrapper.ts — the installed trust wrapper (spec 0252 requirement 12;
// spec 0084, 0247 requirement 16). The TypeScript twin of
// scripts/lib/tls-exec.sh, installed as ~/.crewrig/tls-exec.ts.
//
// Usage: node tls-exec.ts [--end-nonzero-on-child-exit] <command> [args...]
//
// Reads ~/.crewrig/tls-env.sh with the reader of tls-env.ts (parsed, never
// executed), adds its variables to the command's environment and runs the
// command with inherited streams. The flag is parsed before the first
// non-flag argument only. Without it the wrapper exits with the child's own
// status (what launchd and systemd rely on); with it a child that ends for any
// reason ends the wrapper non-zero (what a Windows task needs). An absent
// trust file is silent; a malformed or unreadable one yields one warning on
// standard error naming the file and the first offending line, and the command
// still runs.
//
// BUNDLE: ~/.crewrig/service-lib/ holds launcher-child.ts (scripts/lib/service/
// launcher/) and tls-env.ts (scripts/lib/), both importing only node modules.
// This repository copy imports by repository-relative path so it typechecks in
// place; the installer rewrites each import specifier of THIS file to
// `./service-lib/<basename>` (see bundle.ts). It never imports the MCP
// launcher's files beyond launcher-child.ts (plan v3 step 12).

import { spawn } from "node:child_process";
import os from "node:os";
import { superviseChild } from "./launcher-child.ts";
import { readTlsEnv } from "../../tls-env.ts";

export const FLAG = "--end-nonzero-on-child-exit";

const argv = process.argv.slice(2);
const flagged = argv[0] === FLAG;
const command = flagged ? argv.slice(1) : argv;
const program = command[0];
if (program === undefined) {
  process.stderr.write(`usage: tls-exec.ts [${FLAG}] <command> [args...]\n`);
  process.exit(2);
}

const env: Record<string, string | undefined> = { ...process.env };
const trust = readTlsEnv(os.homedir());
if (trust.kind === "ok") {
  Object.assign(env, trust.vars);
} else if (trust.kind === "malformed") {
  process.stderr.write(
    `tls-exec: ignoring ${trust.file}: line ${trust.line} is outside the managed format\n`,
  );
} else if (trust.kind === "unreadable") {
  process.stderr.write(`tls-exec: ignoring ${trust.file}: the file could not be read\n`);
}

superviseChild({
  spawn: () =>
    spawn(program, command.slice(1), {
      stdio: "inherit",
      env: env as NodeJS.ProcessEnv,
      windowsHide: true,
    }),
  onSignal: (signal, handler) => process.on(signal, handler),
  exit: (code) => process.exit(code),
  log: (line) => process.stdout.write(`${line}\n`),
  endNonzeroOnChildExit: flagged,
});
