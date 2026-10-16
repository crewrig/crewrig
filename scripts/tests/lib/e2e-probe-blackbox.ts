// e2e-probe-blackbox.ts — black-box runner for the live vendor probes (spec 0261 R11): run
// `scripts/<name>` as a subject chosen by file presence (`node <name>.ts` when the .ts exists, else
// `LC_ALL=C bash <name>.sh`; env PROBE_BLACKBOX_LEG=shell|entry forces one) inside a scratch sandbox.
// The sandbox holds a scratch HOME, TMPDIR and CREWRIG_USAGE_ROOT and a scratch `bin/` that is the
// WHOLE PATH: symlinks to a fixed coreutil set plus stand-in vendor executables (`claude`, `gemini`,
// `copilot`, `agy`, `gh`) written at test time, never tracked. Every stand-in logs its argv to
// `calls.log`. Output is held as UTF-8 strings; scratch paths in output are normalised. POSIX only.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { isForwardingShim } from "./e2e-shim.ts";
import { findTool, linkTools } from "./hermetic-env.ts";

const SCRIPTS = path.resolve(import.meta.dirname, "..", "..");

/** Coreutils and tools the probes and `usage-headless.ts` shells out to; vendor binaries are NOT here. */
export const PROBE_TOOLS: readonly string[] =
  "bash env sh node strings readlink mktemp date head tail cat grep sed awk tr cut wc sort rm mkdir mv cp ln chmod dirname basename diff uname sleep".split(
    " ",
  );

/** A skip reason when the host lacks a tool the probes need (`strings` is binutils), else `false`. */
export function hostLacksProbeTools(extra: readonly string[] = []): string | false {
  const missing = [...PROBE_TOOLS, ...extra].filter((name) => findTool(name) === undefined);
  return missing.length > 0 ? `skipped: the host lacks ${missing.join(", ")}` : false;
}

export interface ProbeCase {
  /** `probe-extension-hooks` or `probe-extension-mcp-token`. */
  readonly script: string;
  readonly args?: readonly string[];
  /** Stand-in executables by name: the full file content (shebang included). */
  readonly standIns: Readonly<Record<string, string>>;
  /** Extra host tools linked into `bin/` (e.g. `jq`, `timeout`). */
  readonly tools?: readonly string[];
  /** Files seeded under the scratch HOME, by relative path. */
  readonly homeFiles?: Readonly<Record<string, string>>;
  readonly env?: Readonly<Record<string, string>>;
  /** Force the subject: the `.sh` (`shell`) or the `.ts` twin (`entry`); wins over PROBE_BLACKBOX_LEG. */
  readonly leg?: "shell" | "entry";
}

export interface ProbeRun {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  /** Files under HOME and CREWRIG_USAGE_ROOT after the run, by sandbox-relative path. */
  readonly files: Record<string, string>;
  /** argv log of the stand-ins, one `name <a> <b>` line per call, scratch paths normalised. */
  readonly calls: string;
  /** Names left in the scratch TMPDIR (the probe must remove its own mktemp directories). */
  readonly tmpLeft: string[];
  /** The scratch root, for assertions that need an absolute path. */
  readonly root: string;
  /** Replace scratch paths with `<SCRATCH>` / `<WORK>`. */
  readonly norm: (text: string) => string;
}

export type Subject = { kind: "entry"; file: string } | { kind: "shell"; file: string };

/** A skip reason when the shell leg of `script` is unavailable (the `.sh` is a forwarding shim). */
export function shellLegUnavailable(script: string): string | false {
  return isForwardingShim(path.join(SCRIPTS, `${script}.sh`))
    ? "the .sh is a forwarding shim: the recorded goldens are the oracle once the shell implementation is gone"
    : false;
}

/** The subject by file presence: the `.ts` twin when it exists, else the `.sh`. */
export function subjectOf(script: string, leg?: "shell" | "entry"): Subject {
  const ts = path.join(SCRIPTS, `${script}.ts`);
  const sh = path.join(SCRIPTS, `${script}.sh`);
  const forced = leg ?? process.env["PROBE_BLACKBOX_LEG"];
  if (forced === "shell") return { kind: "shell", file: sh };
  if (forced === "entry") return { kind: "entry", file: ts };
  return fs.existsSync(ts) ? { kind: "entry", file: ts } : { kind: "shell", file: sh };
}

/** A `#!/bin/sh` stand-in: logs its argv, answers `--version`, then runs `body` for other calls. */
export function shStandIn(name: string, calls: string, version: string, body = "exit 0"): string {
  return [
    "#!/bin/sh",
    `printf '%s' '${name}' >> '${calls}'`,
    `for a in "$@"; do printf ' <%s>' "$a" >> '${calls}'; done`,
    `printf '\\n' >> '${calls}'`,
    `if [ "$1" = "--version" ]; then echo '${version}'; exit 0; fi`,
    body,
    "",
  ].join("\n");
}

export type CopilotMode = "root" | "subdir" | "none" | "fail";

/**
 * A node stand-in for Copilot. For every `--plugin-dir <d>` it plays the hook file the real CLI
 * would load: `root` runs `<d>/hooks.json`, `subdir` runs `<d>/hooks/hooks.json` (preToolUse
 * commands whose matcher regex matches `bash`, with COPILOT_PLUGIN_ROOT set to `<d>` and cwd `<d>`).
 * `none` runs nothing and exits 0; `fail` prints `boom` and exits 3.
 */
export function copilotStandIn(calls: string, mode: CopilotMode, version = "1.0.80"): string {
  return `#!/usr/bin/env node
const fs = require("node:fs");
const cp = require("node:child_process");
const a = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(calls)}, "copilot" + a.map((x) => " <" + x + ">").join("") + "\\n");
if (a[0] === "--version") { console.log("${version}"); process.exit(0); }
if (${JSON.stringify(mode)} === "fail") { console.log("boom: simulated copilot failure"); process.exit(3); }
if (${JSON.stringify(mode)} === "none") process.exit(0);
const rel = ${JSON.stringify(mode)} === "root" ? "hooks.json" : "hooks/hooks.json";
a.forEach((x, i) => {
  if (x !== "--plugin-dir") return;
  const dir = a[i + 1];
  let doc;
  try { doc = JSON.parse(fs.readFileSync(dir + "/" + rel, "utf8")); } catch { return; }
  for (const h of (doc.hooks && doc.hooks.preToolUse) || []) {
    if (!new RegExp(h.matcher).test("bash")) continue;
    cp.spawnSync("/bin/sh", ["-c", h.command], { cwd: dir, env: { ...process.env, COPILOT_PLUGIN_ROOT: dir } });
  }
});
console.log("done");
`;
}

function snapshot(root: string, rel: string, out: Record<string, string>): void {
  const dir = path.join(root, rel);
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir).sort()) {
    const at = `${rel}/${name}`;
    const st = fs.lstatSync(path.join(root, at));
    if (st.isDirectory()) snapshot(root, at, out);
    else out[at] = fs.readFileSync(path.join(root, at)).toString("latin1");
  }
}

/** Run one probe case in a fresh sandbox. `calls` is the path the stand-ins log to (see `sandbox`). */
export function runProbe(build: (calls: string) => ProbeCase): ProbeRun {
  if (process.platform === "win32") throw new Error("e2e-probe-blackbox: POSIX only");
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "probe-bb-")));
  try {
    const [home, tmp, bin, usage] = ["home", "tmp", "bin", "usage"].map((d) => path.join(root, d));
    for (const d of [home, tmp, bin]) fs.mkdirSync(d as string);
    const calls = path.join(root, "calls.log");
    const testCase = build(calls);
    const missing = linkTools(bin as string, [...PROBE_TOOLS, ...(testCase.tools ?? [])]);
    if (missing.length > 0) throw new Error(`e2e-probe-blackbox: host lacks ${missing.join(", ")}`);
    for (const [name, content] of Object.entries(testCase.standIns))
      fs.writeFileSync(path.join(bin as string, name), content, { mode: 0o755 });
    for (const [rel, content] of Object.entries(testCase.homeFiles ?? {})) {
      const abs = path.join(home as string, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content);
    }
    const env: NodeJS.ProcessEnv = {
      PATH: bin as string,
      HOME: home as string,
      TMPDIR: tmp as string,
      CREWRIG_USAGE_ROOT: usage as string,
      LC_ALL: "C",
      ...testCase.env,
    };
    delete env["CI"];
    delete env["NODE_TEST_CONTEXT"];
    const subject = subjectOf(testCase.script, testCase.leg);
    const [cmd, argv] =
      subject.kind === "entry"
        ? [
            process.execPath,
            [
              "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
              subject.file,
              ...(testCase.args ?? []),
            ],
          ]
        : [findTool("bash") ?? "bash", [subject.file, ...(testCase.args ?? [])]];
    const res = spawnSync(cmd, argv, { env, encoding: "utf8", cwd: root, maxBuffer: 1 << 24 });
    const norm = (text: string): string =>
      text
        .replace(/[^\s<>=]*\/tmp\.[A-Za-z0-9]+/g, "<WORK>")
        .split(root)
        .join("<SCRATCH>");
    const files: Record<string, string> = {};
    snapshot(root, "home", files);
    snapshot(root, "usage", files);
    // BSD mktemp ignores TMPDIR, so a probe's own scratch directory may live outside `tmp/`:
    // every `.../tmp.XXXX` the stand-ins logged must be gone, and is removed here if not.
    const rawCalls = fs.existsSync(calls) ? fs.readFileSync(calls, "utf8") : "";
    const leftovers = [...new Set(rawCalls.match(/[^\s<>=]*\/tmp\.[A-Za-z0-9]+/g) ?? [])].filter(
      (p) => fs.existsSync(p),
    );
    for (const p of leftovers) fs.rmSync(p, { recursive: true, force: true });
    return {
      status: res.status,
      stdout: norm(res.stdout),
      stderr: norm(res.stderr),
      files,
      calls: norm(rawCalls),
      tmpLeft: [...fs.readdirSync(tmp as string), ...leftovers.map(norm)],
      root,
      norm,
    };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
