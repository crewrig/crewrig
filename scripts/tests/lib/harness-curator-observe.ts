// harness-curator-observe.ts — the sandbox and the observation of one leg of one case
// of the curator scripts (spec 0258 R28, R29, PLAN v2 step 19).
//
// The leg is an explicit parameter. `shell` runs `LC_ALL=C bash <name>.sh`; `entry` runs plain
// `node <name>.ts` with NO flag; `auto` picks the `.ts` when it exists, else the `.sh`. Each case
// gets a sandbox of its own: `work/`, `home/`, `tmp/` (TMPDIR) and `bin/`, the whole PATH: symlinks
// to the tools the case allows plus stubs written at test time (never tracked). Held as latin1
// strings so a byte stays a byte. POSIX only; the real HOME is never touched.

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { log } from "./harness-curator-stubs.ts";
import type { StubFile } from "./harness-curator-stubs.ts";

export type Leg = "shell" | "entry" | "auto";
export type ResolvedLeg = "shell" | "entry";

export const SCRIPTS_DIR = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "artifacts",
  "library",
  "skills",
  "harness-curator",
  "scripts",
);

export interface HcCase {
  /** Golden directory name, kebab-case. */
  readonly name: string;
  readonly script: "curate" | "setup-labels" | "schedule-curator";
  /** Arguments of the shell leg, and of the entry leg unless `entryArgs` is given. */
  readonly args?: readonly string[];
  readonly entryArgs?: readonly string[];
  readonly input?: string;
  /** `{ROOT}` is replaced by the sandbox root. */
  readonly env?: Readonly<Record<string, string>>;
  /** Tools linked in on top of BASE_TOOLS. */
  readonly tools?: readonly string[];
  readonly stubs?: readonly StubFile[];
  /** Copy the script ALONE into `work/` and run that copy (the no-checkout case, deviation (n)). */
  readonly alone?: boolean;
  /** Deviation tags (spec R31) this case may hit; the only way it may carry overlay goldens. */
  readonly deviations?: readonly string[];
}

export interface Observed {
  status: string;
  stdout: string;
  stderr: string;
  /** The argv log of the stubs, one line per call. */
  calls: string;
  /** Files created or changed by the script, by sandbox-relative path. */
  files: Record<string, string>;
  /** Names left in the sandbox temp directory. */
  tmpLeft: string[];
}

/** What a script may reach by default: the coreutils its body and its stubs use. */
export const BASE_TOOLS: readonly string[] =
  "bash cat env dirname sed mktemp rm mkdir tr wc cut ls cksum head tail awk grep seq".split(" ");

/** First executable regular file named `name` on the host PATH, /usr/bin or /bin. */
export function findTool(name: string): string | undefined {
  const dirs = [...(process.env["PATH"] ?? "").split(path.delimiter), "/usr/bin", "/bin"];
  for (const dir of dirs) {
    if (!path.isAbsolute(dir)) continue;
    const candidate = path.join(dir, name);
    try {
      if (!fs.statSync(candidate).isFile()) continue;
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // keep scanning
    }
  }
  return undefined;
}

export function scriptFile(script: string, ext: "sh" | "ts"): string {
  return path.join(SCRIPTS_DIR, `${script}.${ext}`);
}

export function resolveLeg(script: string, leg: Leg): ResolvedLeg {
  if (leg !== "auto") return leg;
  return fs.existsSync(scriptFile(script, "ts")) ? "entry" : "shell";
}

// --- Observation -----------------------------------------------------------------------------

const sha = (data: Uint8Array): string => crypto.createHash("sha256").update(data).digest("hex");

/** Files under `root` outside `bin/` and `calls.log`, by signature. */
function snapshot(root: string): Map<string, { sig: string; text: string }> {
  const out = new Map<string, { sig: string; text: string }>();
  const walk = (dir: string, rel: string): void => {
    for (const name of fs.readdirSync(dir).sort()) {
      const at = rel === "" ? name : `${rel}/${name}`;
      if (rel === "" && (name === "bin" || name === "calls.log")) continue;
      const abs = path.join(dir, name);
      const st = fs.lstatSync(abs);
      if (st.isDirectory()) walk(abs, at);
      else {
        const bytes = fs.readFileSync(abs);
        out.set(at, { sig: sha(bytes), text: bytes.toString("latin1") });
      }
    }
  };
  walk(root, "");
  return out;
}

interface Names {
  readonly sandbox: string;
  readonly tmp: string;
  readonly node: string;
  readonly script: string;
}

/** Replace what varies between runs; the `.sh` and `.ts` spellings of the script's own path are one (deviation (a)). */
export function normalise(text: string, names: Names): string {
  const name = names.script.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text
    .split(names.tmp)
    .join("<TMP>")
    .split(`${names.sandbox}/home`)
    .join("<HOME>") // before the root: a golden never holds a /home/<owner>/ path (spec 0081)
    .split(names.sandbox)
    .join("<SANDBOX>")
    .split(SCRIPTS_DIR)
    .join("<SCRIPTS>")
    .split(names.node)
    .join("<NODE>")
    .replace(/<TMP>\/[A-Za-z0-9._-]+/g, "<TMP>/<RAND>")
    .replace(
      new RegExp(`((?:<SCRIPTS>|<SANDBOX>/work)/(?:${name}|curate))\\.(?:sh|ts)\\b`, "g"),
      "$1",
    );
}

/** One leg of one case in a fresh sandbox. */
export function observe(testCase: HcCase, leg: ResolvedLeg): Observed {
  if (process.platform === "win32") throw new Error("harness-curator: POSIX only");
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hc-diff-")));
  try {
    const dir = (d: string): string => fs.mkdirSync(path.join(root, d)) ?? path.join(root, d);
    const [home, tmp, bin, work] = ["home", "tmp", "bin", "work"].map(dir) as [
      string,
      string,
      string,
      string,
    ];
    const calls = path.join(root, "calls.log");
    for (const tool of new Set([...BASE_TOOLS, ...(testCase.tools ?? [])])) {
      const found = findTool(tool);
      if (found === undefined) throw new Error(`harness-curator: ${tool} not found on the host`);
      fs.symlinkSync(found, path.join(bin, tool));
    }
    const subst = (text: string): string =>
      text.replaceAll("{ROOT}", root).replaceAll("{CALLS}", calls);
    for (const s of testCase.stubs ?? []) {
      const file = path.join(root, s.path);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.rmSync(file, { force: true }); // a harness symlink must not be written through
      fs.writeFileSync(file, subst(`#!/bin/sh\n${log(s.name)}${s.body}`), { mode: 0o755 });
    }

    const ext = leg === "shell" ? "sh" : "ts";
    let script = scriptFile(testCase.script, ext);
    if (testCase.alone === true) {
      script = path.join(work, `${testCase.script}.${ext}`);
      fs.copyFileSync(scriptFile(testCase.script, ext), script);
    }
    const bash = findTool("bash");
    if (leg === "shell" && bash === undefined) throw new Error("harness-curator: no bash");
    const args =
      leg === "entry" ? (testCase.entryArgs ?? testCase.args ?? []) : (testCase.args ?? []);
    const env: NodeJS.ProcessEnv = {
      HOME: home,
      TMPDIR: tmp,
      PATH: bin,
      LC_ALL: "C",
      CREWRIG_TEST_SERVICE_BIN_DIR: bin,
      CREWRIG_TEST_SERVICE_PLATFORM: "linux",
    };
    for (const [key, value] of Object.entries(testCase.env ?? {})) env[key] = subst(value);
    const before = snapshot(root);
    const res = spawnSync(
      leg === "shell" ? (bash as string) : process.execPath,
      [script, ...args],
      {
        cwd: work,
        env,
        ...(testCase.input === undefined ? {} : { input: Buffer.from(testCase.input, "latin1") }),
        encoding: "buffer",
        timeout: 60_000,
        maxBuffer: 64 * 1024 * 1024,
      },
    );

    const names = { sandbox: root, tmp, node: process.execPath, script: testCase.script };
    const norm = (text: string): string => normalise(text, names);
    const files: Record<string, string> = {};
    for (const [rel, now] of snapshot(root))
      if (before.get(rel)?.sig !== now.sig) files[norm(rel)] = norm(now.text);
    return {
      status: res.status === null ? `signal ${res.signal ?? "unknown"}` : String(res.status),
      stdout: norm((res.stdout ?? Buffer.alloc(0)).toString("latin1")),
      stderr: norm((res.stderr ?? Buffer.alloc(0)).toString("latin1")),
      calls: fs.existsSync(calls) ? norm(fs.readFileSync(calls).toString("latin1")) : "",
      files,
      tmpLeft: fs
        .readdirSync(tmp)
        .sort()
        .map((n) => norm(path.join(tmp, n))),
    };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
