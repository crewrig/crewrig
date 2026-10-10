// install-differential.ts — the harness of the shell-versus-TypeScript differential test of the
// install, manage and link entries (spec 0255 R27; retires with the shell scripts in PR E).
// `twin` builds TWO identical sandboxes, runs the unchanged shell script in one (under LC_ALL=C)
// and the TypeScript entry in the other, and returns what each leg observed: status, stdout,
// stderr and a snapshot of every written tree (kind, mode, bytes, link target), temporary
// directory names normalised. `expectSame` compares them; each expected difference is passed as a
// tagged `Deviation` (`R22(<letter>)`) that rewrites the SHELL observation, so an unlisted
// difference fails.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { REPO } from "./build-fixture-tree.ts";
import { normalise } from "./extension-run.ts";
import { createInstallSandbox } from "./install-sandbox.ts";
import type { InstallSandbox, SandboxOptions } from "./install-sandbox.ts";

export interface Observed {
  status: number | null;
  stdout: string;
  stderr: string;
  tree: string[];
}

export interface Twin {
  readonly shell: Observed;
  readonly node: Observed;
}

/** An expected difference: `tag` names the spec 0255 R22 letter; `apply` rewrites the shell side. */
export interface Deviation {
  readonly tag: string;
  readonly apply: (shell: Observed) => Observed;
}

export interface TwinOptions extends SandboxOptions {
  readonly input?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Run after `setup` on each sandbox, just before the leg (e.g. an `agy` stub). */
  readonly prepare?: (box: InstallSandbox) => void;
}

const SKIP_TOP = new Set(["scripts", ".git", "node_modules", "package.json"]);

/** The extension fixtures the cases share: the real hello-world, copied without `node_modules`. */
export function placeHello(box: InstallSandbox, tier = "core"): void {
  const from = path.join(REPO, "extensions", "core", "hello-world");
  const to = box.tree.resolve(`extensions/${tier}/hello-world`);
  fs.cpSync(from, to, { recursive: true, filter: (e) => path.basename(e) !== "node_modules" });
}

function scrub(text: string, box: InstallSandbox): string {
  const h = box.hermetic;
  const logical = h.root.replace(/^\/private/, "");
  const swapped = normalise(text, box.tree)
    .split(path.basename(box.tree.root))
    .join("<ROOTNAME>")
    .split(h.home)
    .join("<HOME>")
    .split(h.root)
    .join("<TMP>")
    .split(logical)
    .join("<TMP>");
  return swapped;
}

/** Every entry under the home and the repository root, as comparable lines. */
function snapshot(box: InstallSandbox): string[] {
  const out: string[] = [];
  const walk = (dir: string, rel: string, label: string, top: boolean): void => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (top && label === "ROOT" && SKIP_TOP.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      const where = `${label}:${rel === "" ? entry.name : `${rel}/${entry.name}`}`;
      const st = fs.lstatSync(full);
      const mode = (st.mode & 0o7777).toString(8);
      if (st.isSymbolicLink()) out.push(`link ${where} -> ${scrub(fs.readlinkSync(full), box)}`);
      else if (st.isDirectory()) {
        out.push(`dir ${mode} ${where}`);
        walk(full, rel === "" ? entry.name : `${rel}/${entry.name}`, label, false);
      } else {
        const bytes = fs.readFileSync(full);
        const text = bytes.includes(0) ? bytes.toString("hex") : scrub(bytes.toString("utf8"), box);
        out.push(`file ${mode} ${where} ${JSON.stringify(text)}`);
      }
    }
  };
  walk(box.home, "", "HOME", true);
  walk(box.tree.root, "", "ROOT", true);
  return out.sort();
}

function leg(
  box: InstallSandbox,
  kind: "shell" | "node",
  name: string,
  args: readonly string[],
  o: TwinOptions,
) {
  const env: NodeJS.ProcessEnv = { ...box.hermetic.env, LC_ALL: "C" };
  for (const [k, v] of Object.entries(o.env ?? {})) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  const ext = kind === "shell" ? "sh" : "ts";
  const file = box.tree.resolve(`scripts/${name}.${ext}`);
  const cmd = kind === "shell" ? path.join(box.hermetic.bin, "bash") : process.execPath;
  const res = spawnSync(cmd, [file, ...args], {
    encoding: "utf8",
    env,
    cwd: box.tree.root,
    ...(o.input === undefined ? {} : { input: o.input }),
  });
  return {
    status: res.status,
    stdout: scrub(res.stdout, box),
    stderr: scrub(res.stderr, box),
    tree: snapshot(box),
  };
}

/** Two identical sandboxes (`setup` applied to each), one leg each, both observed. */
export function twin(
  setup: (box: InstallSandbox) => void,
  name: string,
  args: readonly string[],
  o: TwinOptions = {},
): Twin {
  const make = (): InstallSandbox => {
    const box = createInstallSandbox({ ...o, links: o.links ?? ["jq", "mv", "sort"] });
    setup(box);
    o.prepare?.(box);
    return box;
  };
  const a = make();
  const b = make();
  return { shell: leg(a, "shell", name, args, o), node: leg(b, "node", name, args, o) };
}

/** Assert both legs agree, after the tagged `deviations` rewrote the shell side. */
export function expectSame(t: Twin, deviations: readonly Deviation[] = []): void {
  const shell = deviations.reduce((s, d) => d.apply(s), t.shell);
  assert.equal(t.node.status, shell.status, "exit status");
  assert.equal(t.node.stdout, shell.stdout, "stdout");
  assert.equal(t.node.stderr, shell.stderr, "stderr");
  assert.deepEqual(t.node.tree, [...shell.tree].sort(), "written trees");
}

/** deviation: R22(i) — the shell's usage line carries `$0`'s path prefix, the TypeScript form not. */
export const USAGE_PREFIX: Deviation = {
  tag: "R22(i)",
  apply: (s) => ({ ...s, stdout: s.stdout.replace(/^Usage: \S*\//m, "Usage: ") }),
};

/** deviation: R22(i) — the shell's `${1:?Usage: ...}` stderr carries `<script>: line N: 1: `, the TypeScript form not. */
export const USAGE_PREFIX_ERR: Deviation = {
  tag: "R22(i)",
  apply: (s) => ({ ...s, stderr: s.stderr.replace(/^\S*: line \d+: 1: Usage:/m, "Usage:") }),
};
