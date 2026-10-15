// create-extension-cases.ts — the shared setup of the scaffolder differential and its golden
// regeneration (spec 0258 R29): one template per test file, one private clone per case, and the
// fixed list of masks the live shell-versus-entry comparison covers.

import { spawnSync } from "node:child_process";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { after } from "node:test";

import {
  SHELL_RETIRED,
  fzfStubDir,
  run,
  shellIsShim,
  snapshot,
} from "./create-extension-observe.ts";
import type { Leg, Observed, RunSpec } from "./create-extension-observe.ts";
import { cloneTemplate, createTemplate } from "./create-extension-sandbox.ts";
import { nameOf } from "./create-extension-golden.ts";

/** Masks 0 and 63, the six single bits and eight fixed pairs: the live subset on Linux. */
export const LIVE_MASKS: readonly number[] = [
  0, 63, 1, 2, 4, 8, 16, 32, 3, 5, 6, 12, 24, 48, 33, 18,
];

/** Why the live shell leg does not run here: a forwarding shim, or no Linux with `bash` and `jq`. */
export const SHELL_LEG_SKIP: string | false = shellIsShim()
  ? SHELL_RETIRED
  : process.platform === "linux" &&
      ["bash", "jq"].every((cmd) => spawnSync(cmd, ["--version"]).error === undefined)
    ? false
    : "needs Linux, bash and jq";

export interface Cases {
  readonly template: string;
  readonly baseline: Record<string, string>;
  readonly stubDir: string;
  /** Run one spec in a fresh clone; `prepare` may change the clone first (e.g. stub the builder). */
  observe(leg: Leg, spec: RunSpec, prepare?: (root: string) => void): Observed;
}

export function createCases(): Cases {
  const template = createTemplate();
  const baseline = snapshot(template);
  const stubParent = fs.mkdtempSync(path.join(os.tmpdir(), "create-extension-stub-"));
  const stubDir = fzfStubDir(stubParent);
  after(() => fs.rmSync(stubParent, { recursive: true, force: true }));
  return {
    template,
    baseline,
    stubDir,
    observe(leg, spec, prepare) {
      const root = cloneTemplate(template);
      prepare?.(root);
      return run(root, leg, spec, baseline, stubDir);
    },
  };
}

export const maskSpec = (mask: number): RunSpec => ({ name: nameOf(mask), mask });
