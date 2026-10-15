// skill-scripts-observe.ts — run one skill script as a black box and describe what it did (spec
// 0258 R28, R29): exit status, both streams, every file written, the argv log of the stub tools
// and whether the sandbox temp directory is empty afterwards.
//
// The leg is an explicit parameter. `shell` runs `LC_ALL=C bash <name>.sh`; `entry` runs plain
// `node <name>.ts` with NO flag (SKILL.md commands carry none, and stderr is compared); `auto`
// picks the `.ts` when it exists, else the `.sh`, so the oracle test's text never changes at the
// switch. Each case gets a sandbox of its own: `work/` (cwd, fixtures), `home/`, `tmp/` (TMPDIR),
// `bin/` (the whole PATH: symlinks to the tools the case allows plus stubs written at test time)
// and `calls.log`. Held as latin1 strings so a byte stays a byte. POSIX only.

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { skillPlaceholder } from "./golden-normalize.ts";
import { findTool, linkTools } from "./hermetic-env.ts";

export type Leg = "shell" | "entry" | "auto";
export type ResolvedLeg = "shell" | "entry";
/** The `package.json` beside an isolated entry copy: spec 0258 R2 (`none` writes no package.json). */
export type Layout = "module" | "commonjs" | "typeless" | "none";
export const LAYOUT_PACKAGE: Readonly<Record<Layout, string | undefined>> = {
  module: '{"type":"module"}\n',
  commonjs: '{"type":"commonjs"}\n',
  typeless: "{}\n",
  none: undefined,
};

export const SKILLS_ROOT = path.resolve(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "artifacts",
  "core",
  "skills",
);

export interface SkillCase {
  /** Golden directory name, kebab-case. */
  readonly name: string;
  /** `<skill>/<script>`, e.g. `github-actions/check-pinned-actions`. */
  readonly script: string;
  /** `{WORK}` is replaced by the working directory. */
  readonly args?: readonly string[];
  /** Fixture files relative to `work/`, as latin1 text. */
  readonly files?: Readonly<Record<string, string>>;
  readonly dirs?: readonly string[];
  /** Symlinks relative to `work/`: path -> literal link target. */
  readonly links?: Readonly<Record<string, string>>;
  /** Tools linked in on top of BASE_TOOLS (`git`, `jq`, `yq`) and tools taken away from it. */
  readonly tools?: readonly string[];
  readonly without?: readonly string[];
  /** Stub tools written into `bin/` as `#!/bin/sh`; the value is the body after the argv log line. */
  readonly stubs?: Readonly<Record<string, string>>;
  /** `git` invocations run in `work/` before the script (`["init", "-q"]`, ...). */
  readonly git?: readonly (readonly string[])[];
  readonly input?: string;
  readonly env?: Readonly<Record<string, string>>;
  /** Working directory relative to `work/`. */
  readonly cwd?: string;
  /** Normalise the JSON parse message (deviation (c)). */
  readonly jsonMessage?: boolean;
  /** Deviation tag of requirement 31: the only way a case may carry an overlay golden. */
  readonly deviation?: string;
}

export interface Observed {
  status: string;
  stdout: string;
  stderr: string;
  /** Files created or changed by the script, by sandbox-relative path. */
  files: Record<string, string>;
  /** The argv log of the stubs, one line per call. */
  calls: string;
  /** Names left in the sandbox temp directory. */
  tmpLeft: string[];
}

/** What a script may reach by default: the coreutils its body uses, and nothing else. */
export const BASE_TOOLS: readonly string[] =
  "bash basename dirname find cat grep sed awk tr head tail wc sort cut mktemp rm mkdir uname env".split(
    " ",
  );

const sha = (data: Uint8Array): string => crypto.createHash("sha256").update(data).digest("hex");

export function scriptFile(script: string, ext: "sh" | "ts"): string {
  const [skill, name] = script.split("/");
  if (skill === undefined || name === undefined) throw new Error(`bad script id: ${script}`);
  return path.join(SKILLS_ROOT, skill, "scripts", `${name}.${ext}`);
}

/**
 * `auto` honours env `SKILL_ORACLE_LEG=shell|entry` (a proof forces a leg while both files exist),
 * else picks the `.ts` when it exists and the `.sh` when it does not.
 */
export function resolveLeg(script: string, leg: Leg): ResolvedLeg {
  if (leg !== "auto") return leg;
  const forced = process.env["SKILL_ORACLE_LEG"];
  if (forced === "shell" || forced === "entry") return forced;
  return fs.existsSync(scriptFile(script, "ts")) ? "entry" : "shell";
}

/**
 * A `lint-skill` case that links no `yq` declares "no YAML parser": its entry runs from an isolated
 * copy of the single `.ts` file with no `node_modules` above it, so `js-yaml` cannot resolve and
 * the line fallback is measured. A case that links `yq` runs from the repository (`js-yaml` found).
 */
export function isolatedEntry(testCase: Pick<SkillCase, "script" | "tools">): boolean {
  return testCase.script === "pr-reviewer/lint-skill" && testCase.tools?.includes("yq") !== true;
}

/** Files and symlinks under `root` outside `bin/`, `calls.log` and `.git`, by signature. */
function snapshot(root: string): Map<string, { sig: string; text: string }> {
  const out = new Map<string, { sig: string; text: string }>();
  const walk = (dir: string, rel: string): void => {
    for (const name of fs.readdirSync(dir).sort()) {
      const at = rel === "" ? name : `${rel}/${name}`;
      if (rel === "" && (name === "bin" || name === "calls.log")) continue;
      if (name === ".git") continue;
      const abs = path.join(dir, name);
      const st = fs.lstatSync(abs);
      if (st.isSymbolicLink()) {
        const text = `symlink -> ${fs.readlinkSync(abs)}`;
        out.set(at, { sig: text, text });
      } else if (st.isDirectory()) walk(abs, at);
      else {
        const bytes = fs.readFileSync(abs);
        out.set(at, { sig: sha(bytes), text: bytes.toString("latin1") });
      }
    }
  };
  walk(root, "");
  return out;
}

function writeStub(bin: string, calls: string, name: string, body: string): void {
  const log =
    `printf '%s' '${name}' >> '${calls}'\n` +
    `for a in "$@"; do printf ' <%s>' "$a" >> '${calls}'; done\n` +
    `printf '\\n' >> '${calls}'\n`;
  const file = path.join(bin, name);
  fs.rmSync(file, { force: true }); // a harness symlink must not be written through
  fs.writeFileSync(file, `#!/bin/sh\n${log}${body}`, { mode: 0o755 });
}

function gitSetup(testCase: SkillCase, work: string, home: string): void {
  const git = findTool("git");
  for (const argv of testCase.git ?? []) {
    if (git === undefined) throw new Error("skill-scripts-observe: git is not on the host PATH");
    const res = spawnSync(git, [...argv], {
      cwd: work,
      encoding: "utf8",
      env: {
        HOME: home,
        PATH: path.dirname(git),
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_AUTHOR_NAME: "Oracle",
        GIT_AUTHOR_EMAIL: "oracle@example.invalid",
        GIT_COMMITTER_NAME: "Oracle",
        GIT_COMMITTER_EMAIL: "oracle@example.invalid",
        GIT_AUTHOR_DATE: "2000-01-01T00:00:00Z",
        GIT_COMMITTER_DATE: "2000-01-01T00:00:00Z",
      },
    });
    if (res.status !== 0) throw new Error(`git ${argv.join(" ")} failed: ${res.stderr}`);
  }
}

/** One leg of one case in a fresh sandbox; a `layout` runs the entry as an isolated copy of its file. */
export function observe(testCase: SkillCase, leg: ResolvedLeg, layout?: Layout): Observed {
  if (process.platform === "win32") throw new Error("skill-scripts-observe: POSIX only");
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "skill-oracle-")));
  try {
    const [home, tmp, bin, work] = ["home", "tmp", "bin", "work"].map((d) => path.join(root, d));
    for (const dir of [home, tmp, bin, work]) fs.mkdirSync(dir as string);
    const calls = path.join(root, "calls.log");
    const dirs = { home: home as string, tmp: tmp as string, bin: bin as string };
    const workDir = work as string;

    const allowed = [...BASE_TOOLS, ...(testCase.tools ?? [])].filter(
      (tool) => !(testCase.without ?? []).includes(tool) && !(leg === "entry" && tool === "yq"), // no entry spawns yq
    );
    const missing = linkTools(dirs.bin, [...new Set(allowed)]);
    if (missing.length > 0)
      throw new Error(`skill-scripts-observe: not found on the host: ${missing.join(", ")}`);
    for (const [name, body] of Object.entries(testCase.stubs ?? {}))
      writeStub(dirs.bin, calls, name, body);

    for (const dir of testCase.dirs ?? [])
      fs.mkdirSync(path.join(workDir, dir), { recursive: true });
    for (const [rel, text] of Object.entries(testCase.files ?? {})) {
      const file = path.join(workDir, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, Buffer.from(text, "latin1"));
    }
    for (const [rel, target] of Object.entries(testCase.links ?? {})) {
      const file = path.join(workDir, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.symlinkSync(target, file);
    }
    gitSetup(testCase, workDir, dirs.home);

    const bash = findTool("bash");
    if (leg === "shell" && bash === undefined) throw new Error("skill-scripts-observe: no bash");
    let entry = scriptFile(testCase.script, leg === "shell" ? "sh" : "ts");
    if (leg === "entry" && (layout !== undefined || isolatedEntry(testCase))) {
      const iso = path.join(root, "iso");
      fs.mkdirSync(iso);
      const pkg = layout === undefined ? undefined : LAYOUT_PACKAGE[layout];
      if (pkg !== undefined) fs.writeFileSync(path.join(iso, "package.json"), pkg);
      fs.copyFileSync(entry, path.join(iso, path.basename(entry)));
      entry = path.join(iso, path.basename(entry));
    }
    const args = (testCase.args ?? []).map((a) => a.replaceAll("{WORK}", workDir));
    const before = snapshot(root);
    const res = spawnSync(leg === "shell" ? (bash as string) : process.execPath, [entry, ...args], {
      cwd: path.join(workDir, testCase.cwd ?? ""),
      env: { HOME: dirs.home, TMPDIR: dirs.tmp, PATH: dirs.bin, LC_ALL: "C", ...testCase.env },
      ...(testCase.input === undefined ? {} : { input: Buffer.from(testCase.input, "latin1") }),
      encoding: "buffer",
      timeout: 30_000,
      maxBuffer: 64 * 1024 * 1024,
    });

    const names = {
      sandbox: root,
      tmp: dirs.tmp,
      node: process.execPath,
      script: testCase.script.split("/")[1] as string,
      jsonMessage: leg === "entry" && testCase.jsonMessage === true, // the shell goldens keep the raw jq text
    };
    const norm = (text: string): string => skillPlaceholder(text, names);
    const files: Record<string, string> = {};
    for (const [rel, now] of snapshot(root)) {
      if (before.get(rel)?.sig !== now.sig) files[norm(rel)] = norm(now.text);
    }
    return {
      status: res.status === null ? `signal ${res.signal ?? "unknown"}` : String(res.status),
      stdout: norm((res.stdout ?? Buffer.alloc(0)).toString("latin1")),
      stderr: norm((res.stderr ?? Buffer.alloc(0)).toString("latin1")),
      files,
      calls: fs.existsSync(calls) ? norm(fs.readFileSync(calls).toString("latin1")) : "",
      tmpLeft: fs
        .readdirSync(dirs.tmp)
        .sort()
        .map((n) => norm(path.join(dirs.tmp, n))),
    };
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
