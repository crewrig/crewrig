// overlay-loop-box.ts — sandbox repository and HOME for scripts/tests/manage-overlay-loop.test.ts.
// `claude` and the staging rebuild are stand-ins; nothing here touches the real HOME.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import type { Io } from "../../lib/extension/types.ts";
import { runOverlayLoop } from "../../lib/manage/overlay-loop.ts";
import type { LoopDeps, LoopRequest, LoopResult } from "../../lib/manage/overlay-loop.ts";
import { newPlaceCtx } from "../../lib/manage/place.ts";
import type { CliDescriptor } from "../../lib/manage/types.ts";

const work = fs.mkdtempSync(path.join(os.tmpdir(), "manage-overlay-loop-"));
let n = 0;

export function disposeBoxes(): void {
  fs.rmSync(work, { recursive: true, force: true });
}

export interface Box {
  repo: string;
  home: string;
  out: string[];
  err: string[];
  raw: string[];
  claudeCalls: string[][];
  run: (cli: CliDescriptor, type: string, name?: string, mode?: "install" | "link") => LoopResult;
}

/** Compiled-tree fixtures: the stand-in rebuild writes them back after the prune that empties dist. */
const compiled = new Map<string, string>();

export function write(file: string, text: string): void {
  if (file.includes(`${path.sep}dist${path.sep}`)) compiled.set(file, text);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

export function skill(file: string, name: string, prov: boolean): void {
  const meta = prov
    ? ["metadata:", "  provenance:", '    canonical: "https://example.test/x"']
    : [];
  write(file, ["---", `name: ${name}`, ...meta, "---", "", `# ${name}`, ""].join("\n"));
}

export function newBox(): Box {
  compiled.clear();
  const root = path.join(work, `b${(n += 1)}`);
  fs.mkdirSync(root, { recursive: true });
  const repo = path.join(root, "repo");
  const home = path.join(root, "home");
  fs.mkdirSync(repo);
  fs.mkdirSync(home);
  const b: Box = {
    repo,
    home,
    out: [],
    err: [],
    raw: [],
    claudeCalls: [],
    run: () => ({ status: -1, abort: false }),
  };
  const io: Io = {
    out: (l) => b.out.push(l),
    err: (l) => b.err.push(l),
    errRaw: (t) => b.raw.push(t),
  };
  const bin = path.join(root, "bin");
  write(path.join(bin, "claude"), "");
  fs.chmodSync(path.join(bin, "claude"), 0o755);
  b.run = (cli, type, name = "", mode = "install") => {
    const req: LoopRequest = { cli, type, name, mode, repoDir: repo, home };
    const deps: LoopDeps = {
      io,
      place: newPlaceCtx(io, {}, process.platform),
      claude: {
        env: { PATH: bin },
        platform: process.platform,
        spawn: (_file, args) => {
          b.claudeCalls.push([...args]);
          return { status: 0, stdout: "" };
        },
      },
      rebuild: () => {
        for (const [file, text] of compiled) write(file, text);
        return { status: 0, output: "" };
      },
    };
    return runOverlayLoop(req, deps);
  };
  return b;
}
