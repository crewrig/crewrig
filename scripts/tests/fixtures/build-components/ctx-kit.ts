// ctx-kit.ts — a hand-built build context for the unit suites of the write, resources and
// provenance modules (spec 0250 R12, R14, R15, R16): a `Ctx` over the real `js-yaml`
// (scripts/tests/lib/yaml-lib.ts), an `Io` that records, and the umask and mode helpers the
// file-mode cases need. Nothing here reimplements a module under test.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after } from "node:test";

import { createFrontmatter } from "../../../lib/build-components/frontmatter.ts";
import { readUmask } from "../../../lib/build-components/resources.ts";
import type {
  BuildOptions,
  Config,
  Ctx,
  Io,
  SourceDoc,
} from "../../../lib/build-components/types.ts";
import { yamlLib } from "../../lib/yaml-lib.ts";

const temps: string[] = [];
after(() => {
  for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
});

/** A fresh physical temporary directory, removed when the test file ends. */
export function tempDir(): string {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "bc-unit-")));
  temps.push(dir);
  return dir;
}

/** Permission bits (`0o777` mask) of a file. */
export const modeOf = (file: string): number => fs.statSync(file).mode & 0o777;

/** Run `fn` with the process umask set to `mask`, restoring it afterwards. */
export function withUmask<T>(mask: number, fn: () => T): T {
  const before = process.umask(mask);
  try {
    return fn();
  } finally {
    process.umask(before);
  }
}

export interface CtxKitOptions {
  /** `--check` was given. */
  readonly check?: boolean;
  /** `CHECK_COMPARE`: the tier is drift-compared (default true). */
  readonly compare?: boolean;
  readonly config?: Config;
  readonly platform?: NodeJS.Platform;
}

export interface CtxKit {
  readonly ctx: Ctx;
  /** Lines written with `io.out`. */
  readonly out: string[];
  /** Lines written with `io.err`, then raw text of `io.errRaw`. */
  readonly err: string[];
  /** Write a source file in a fresh directory and open it as the build does. */
  open(text: string): SourceDoc;
}

/** A context whose `umask` is the process umask at the time of the call. */
export function makeCtx(options: CtxKitOptions = {}): CtxKit {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = {
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    errRaw: (text) => err.push(text),
  };
  const platform = options.platform ?? process.platform;
  const opts: BuildOptions = {
    target: "all",
    tierFilter: null,
    check: options.check ?? false,
    listOutputDirs: false,
    resolve: null,
    diagnosticsPath: "",
  };
  const repoDir = tempDir();
  const fm = createFrontmatter(yamlLib);
  const ctx: Ctx = {
    opts,
    repoDir,
    artifactsDir: path.join(repoDir, "artifacts"),
    env: {},
    platform,
    io,
    umask: readUmask(platform),
    fm,
    state: { driftFound: false, compare: options.compare ?? true, stagingRoot: "" },
    config: options.config ?? { placeholders: [], canonicalRepo: "" },
  };
  return {
    ctx,
    out,
    err,
    open(text) {
      const file = path.join(tempDir(), "SKILL.md");
      fs.writeFileSync(file, text);
      return fm.open(file);
    },
  };
}
