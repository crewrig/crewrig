// transcript-golden-capture.ts — record the golden data of the transcript hook
// (spec 0247 plan, verification duty 2). A one-off, run by hand; CI only
// replays the result (scripts/tests/mempalace-transcript-golden.test.ts).
//
// It runs the SHELL hook as it stood before the migration against the stub
// daemon over the row matrix below, and records each outcome as `expect`. It
// then runs the TypeScript hook over the same rows: a row whose outcome
// differs must carry `deviation: "R30/<clause>"` (and its TypeScript outcome
// is recorded as `ts`), a row that carries one must differ. Anything else
// stops the capture, so no unlisted difference reaches the golden file.
//
// Regenerate (needs bash, jq, curl, git; a UTF-8 locale for `${v:0:n}`):
//   git show a7468111:hooks/mempalace-transcript.sh > /tmp/mempalace-transcript.sh
//   node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
//     scripts/tests/lib/transcript-golden-capture.ts /tmp/mempalace-transcript.sh
//
// Standard library only.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { GOLDEN_ROWS } from "./transcript-golden-rows.ts";
import {
  replayRow,
  type GoldenOutcome,
  type GoldenRow,
  type HookCommand,
} from "./transcript-golden.ts";
import { HOOK_TS, startStub, type Stub, type StubMode } from "./transcript-runtime.ts";
import { cleanupAll, REPO } from "./worktree-fixtures.ts";

const OUT = path.join(
  REPO,
  "scripts",
  "tests",
  "fixtures",
  "mempalace-transcript",
  "golden",
  "matrix.json",
);
const SOURCE = "a7468111:hooks/mempalace-transcript.sh";

const shellHook = process.argv[2];
if (shellHook === undefined || !fs.existsSync(shellHook)) {
  process.stderr.write("usage: transcript-golden-capture.ts <copy of the shell hook>\n");
  process.exit(2);
}

const shell: HookCommand = { program: "bash", prefix: [shellHook], env: { LC_ALL: "en_US.UTF-8" } };
const typescript: HookCommand = { program: process.execPath, prefix: [HOOK_TS] };

const same = (a: GoldenOutcome, b: GoldenOutcome): boolean => {
  try {
    assert.deepEqual(a, b);
    return true;
  } catch {
    return false;
  }
};

const stubs = new Map<StubMode, Stub>();
for (const mode of ["ok", "rpc-error", "is-error", "http-500-html", "hang"] as const) {
  stubs.set(mode, await startStub(mode));
}

const rows: GoldenRow[] = [];
let problems = 0;
try {
  for (const input of GOLDEN_ROWS) {
    const expect = await replayRow(input, shell, stubs);
    const ts = await replayRow(input, typescript, stubs);
    const differs = !same(expect, ts);
    if (differs !== (input.deviation !== undefined)) {
      problems += 1;
      process.stderr.write(
        `${input.id}: ${differs ? "differs without a deviation" : `carries ${input.deviation ?? ""} but does not differ`}\n` +
          `  shell: ${JSON.stringify(expect)}\n  ts:    ${JSON.stringify(ts)}\n`,
      );
    }
    rows.push(differs ? { ...input, expect, ts } : { ...input, expect });
    process.stderr.write(
      `${input.id}: ${differs ? `deviation ${input.deviation ?? "?"}` : "same"}\n`,
    );
  }
} finally {
  for (const stub of stubs.values()) await stub.stop();
  cleanupAll();
}

if (problems > 0) {
  process.stderr.write(`${problems} row(s) need attention; ${OUT} not written\n`);
  process.exit(1);
}
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(
  OUT,
  `${JSON.stringify({ source: SOURCE, capturedOn: process.platform, locale: "en_US.UTF-8", rows }, null, 2)}\n`,
);
process.stderr.write(`wrote ${rows.length} rows to ${OUT}\n`);
