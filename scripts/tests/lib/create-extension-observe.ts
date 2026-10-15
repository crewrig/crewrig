// create-extension-observe.ts — run the scaffolder as a black box and describe what it did (spec 0258
// R28, R29): exit status, both streams (the sandbox path normalised) and every file it wrote under
// `extensions/` and `build/`, as sorted path -> fingerprint. A fingerprint is the SHA-256 of the
// file's bytes, followed by `:x` for an executable; `dir` for a directory; `link:<target>` for a
// symbolic link; `<deleted>` for a path of the template the run removed.

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { selectionOf } from "./create-extension-sandbox.ts";

export type Leg = "shell" | "entry";

export interface Observed {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly files: Record<string, string>;
}

export interface RunSpec {
  readonly name: string;
  /** Bitmask of the offered components; the selection variable is set from it. */
  readonly mask?: number;
  /** Extra or overriding environment; `undefined` removes a variable. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly args?: readonly string[];
}

const WATCHED = ["extensions", "build"];

export const sha256 = (data: Uint8Array | string): string =>
  crypto.createHash("sha256").update(data).digest("hex");

/** Every path under the watched directories, relative to `root`, with its fingerprint. */
export function snapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (rel: string): void => {
    const full = path.join(root, ...rel.split("/"));
    const stat = fs.lstatSync(full, { throwIfNoEntry: false });
    if (stat === undefined) return;
    if (stat.isSymbolicLink()) out[rel] = `link:${fs.readlinkSync(full)}`;
    else if (stat.isDirectory()) {
      out[rel] = "dir";
      for (const name of fs.readdirSync(full)) walk(`${rel}/${name}`);
    } else {
      out[rel] = sha256(fs.readFileSync(full)) + ((stat.mode & 0o111) === 0 ? "" : ":x");
    }
  };
  WATCHED.forEach(walk);
  return out;
}

/** What differs from the template: new and changed paths, and `<deleted>` for removed ones. */
export function writtenSince(
  baseline: Record<string, string>,
  now: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [rel, value] of Object.entries(now)) if (baseline[rel] !== value) out[rel] = value;
  for (const rel of Object.keys(baseline)) if (now[rel] === undefined) out[rel] = "<deleted>";
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** Replace the sandbox root (physical and as given) so two sandboxes print the same text. */
export function normalise(text: string, root: string): string {
  const roots = new Set([root, fs.realpathSync.native(root)]);
  let out = text;
  for (const dir of [...roots].sort((a, b) => b.length - a.length))
    out = out.split(dir).join("<ROOT>");
  return out.split(fs.realpathSync.native(os.tmpdir())).join("<TMP>");
}

/** A directory holding only an `fzf` stub that prints `$CREWRIG_TEST_FZF_SELECTION`. */
export function fzfStubDir(parent: string): string {
  const dir = path.join(parent, "fzf-stub");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "fzf");
  const shebang = String.fromCharCode(35, 33); // never a literal `#!` in a tracked file
  fs.writeFileSync(
    file,
    `${shebang}/bin/bash\ncat > /dev/null\nprintf '%s' "$CREWRIG_TEST_FZF_SELECTION"\n`,
  );
  fs.chmodSync(file, 0o755);
  return dir;
}

/** Run one leg in `root`. The shell leg gets the `fzf` stub; the entry leg never does. */
export function run(
  root: string,
  leg: Leg,
  spec: RunSpec,
  baseline: Record<string, string>,
  stubDir: string,
): Observed {
  const home = path.join(root, ".home");
  fs.mkdirSync(home, { recursive: true });
  const system = ["/usr/local/bin", "/usr/bin", "/bin"];
  const dirs = [path.dirname(process.execPath), ...system];
  const env: Record<string, string | undefined> = {
    PATH: (leg === "shell" ? [stubDir, ...dirs] : dirs).join(path.delimiter),
    HOME: home,
    LC_ALL: "C",
    NAME: spec.name,
    TIER: "org",
  };
  if (spec.mask !== undefined) env["CREWRIG_TEST_FZF_SELECTION"] = selectionOf(spec.mask);
  Object.assign(env, spec.env);
  const argv =
    leg === "shell"
      ? ["bash", "scripts/create-extension.sh", ...(spec.args ?? [])]
      : [process.execPath, "scripts/create-extension.ts", ...(spec.args ?? [])];
  const res = spawnSync(argv[0] as string, argv.slice(1), {
    cwd: root,
    encoding: "utf8",
    input: "",
    env: Object.fromEntries(
      Object.entries(env).filter(([, v]) => v !== undefined),
    ) as NodeJS.ProcessEnv,
  });
  return {
    status: res.status,
    stdout: normalise(res.stdout, root),
    stderr: normalise(res.stderr, root),
    files: writtenSince(baseline, snapshot(root)),
  };
}
