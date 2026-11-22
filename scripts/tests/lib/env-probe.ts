// env-probe.ts — child processes that import scripts/lib/crewrig-cli/env.ts first, as scripts/crewrig-cli.ts does,
// and then report what the rest of the code sees (spec 0315 delta-01 R12, R14; plan v3-F1).
//
// An out-of-process `setup` run never reaches the writers of the six allowlisted settings (the isolation of the
// tests, a PATH without a MemPalace interpreter, keeps it off the daemon path), so two probes stand in: `dumpEnv`
// shows exactly which variables survive the strip, and `installProbe` runs the same code `setup` runs to install the
// daemon (`installMcpDaemon`, with a stub service manager) in a process whose environment env.ts has already
// stripped, then reads the endpoint back the way a hook and the Chroma wrapper do.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { REPO, type Rig } from "./launcher-rig.ts";

const url = (rel: string): string => pathToFileURL(path.join(REPO, ...rel.split("/"))).href;

const DUMP = `import ${JSON.stringify(url("scripts/lib/crewrig-cli/env.ts"))};
process.stdout.write(JSON.stringify(process.env));
`;

const INSTALL = `import ${JSON.stringify(url("scripts/lib/crewrig-cli/env.ts"))};
import fs from "node:fs";
import { createRequire } from "node:module";
const { installMcpDaemon } = await import(${JSON.stringify(url("scripts/lib/service/daemon-install.ts"))});
const { installedPaths } = await import(${JSON.stringify(url("scripts/lib/service/program-install.ts"))});
const { chromaEndpoint } = await import(${JSON.stringify(url("scripts/lib/service/chroma-state.ts"))});
const mcp = createRequire(import.meta.url)(${JSON.stringify(path.join(REPO, "scripts", "lib", "usage-store", "mcp.js"))});
const calls = [];
const ok = { ok: true };
const backend = {
  kind: process.platform === "darwin" ? "launchd" : process.platform === "win32" ? "schtasks" : "systemd",
  install: (...a) => (calls.push("install"), ok),
  start: () => (calls.push("start"), ok),
  stop: () => (calls.push("stop"), ok),
  status: () => ({ registered: true, running: true }),
  uninstall: () => (calls.push("uninstall"), ok),
  supervisorPid: () => ({ state: "none" }),
};
const home = process.env.HOME ?? process.env.USERPROFILE;
const result = await installMcpDaemon({
  repoDir: ${JSON.stringify(REPO)},
  home,
  env: process.env,
  platform: process.platform,
  backend,
  healthz: async () => true,
});
const launcher = installedPaths(home, process.env).launcher;
process.stdout.write(JSON.stringify({
  ok: result.ok,
  lines: result.lines,
  calls,
  launcherText: fs.existsSync(launcher) ? fs.readFileSync(launcher, "utf8") : null,
  hookEndpoint: mcp.endpoint(),
  chroma: chromaEndpoint(),
  tokenPath: mcp.tokenPathNoCreate(),
}));
`;

export interface ProbeOutput<T> {
  readonly status: number | null;
  readonly stderr: string;
  readonly data: T | undefined;
}

function run<T>(
  rig: Rig,
  name: string,
  source: string,
  env: Record<string, string | undefined>,
): ProbeOutput<T> {
  const file = path.join(rig.newDir("probe"), `${name}.mjs`);
  fs.writeFileSync(file, source);
  const child = spawnSync(
    process.execPath,
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", file],
    { env: rig.env(env), encoding: "utf8" },
  );
  let data: T | undefined;
  try {
    data = JSON.parse(child.stdout) as T;
  } catch {
    data = undefined;
  }
  return { status: child.status, stderr: child.stderr, data };
}

/** The environment of a process that has imported env.ts, given the environment `env` it started with. */
export function dumpEnv(
  rig: Rig,
  env: Record<string, string | undefined>,
): ProbeOutput<Record<string, string>> {
  return run(rig, "dump-env", DUMP, env);
}

export interface InstallReport {
  readonly ok: boolean;
  readonly lines: string[];
  readonly calls: string[];
  readonly launcherText: string | null;
  readonly hookEndpoint: { host: string; port: string };
  readonly chroma: { host: string; port: string };
  readonly tokenPath: string;
}

/** `installMcpDaemon` and the run-time readers, in a process that imported env.ts first. */
export function installProbe(
  rig: Rig,
  env: Record<string, string | undefined>,
): ProbeOutput<InstallReport> {
  return run(rig, "install-probe", INSTALL, env);
}
