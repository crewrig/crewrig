// Twin proof for scripts/lib/usage-headless.ts (spec 0261): the six R18 checks of group G15 of
// test-usage-capture.sh section 10 are asserted on the TypeScript module directly (the shell
// original is retired, spec 0261 requirement 17 and delta-01).

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";

import {
  usageHeadlessAgyRewriteJsonResponse,
  usageHeadlessCaptureUsageFile,
} from "../lib/usage-headless.ts";

const REPO = path.resolve(import.meta.dirname, "..", "..");
const FIXTURES = path.join(REPO, "scripts", "tests", "fixtures", "usage-capture", "headless");
const AGY_ENVELOPE = path.join(FIXTURES, "antigravity-envelope", "envelope.json");
const COPILOT_ENVELOPE = path.join(FIXTURES, "copilot-cli-envelope", "envelope.json");
interface Json {
  response?: string;
  timing: { captureInstant?: string };
  identity: { sessionId: string };
  idempotencyKey?: string;
  recordId?: string;
}
const LAUNCH = "2026-01-01T00:00:00.000Z";
const CANARY = String((JSON.parse(fs.readFileSync(AGY_ENVELOPE, "utf8")) as Json).response).split(
  ":",
)[0];

const roots: string[] = [];

after(() => {
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
});

interface Scratch {
  readonly work: string;
  readonly home: string;
  readonly usage: string;
  readonly tmp: string;
  readonly scan: string;
}

function scratch(): Scratch {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "usage-headless-"));
  roots.push(work);
  const s = {
    work,
    home: path.join(work, "home"),
    usage: path.join(work, "usage"),
    tmp: path.join(work, "tmp"),
    scan: path.join(work, "scan.log"),
  };
  for (const d of [s.home, s.usage, s.tmp]) fs.mkdirSync(d);
  fs.writeFileSync(s.scan, "");
  return s;
}

function envOf(s: Scratch): Record<string, string> {
  return {
    HOME: s.home,
    TMPDIR: s.tmp,
    CREWRIG_USAGE_ROOT: s.usage,
    PATH: "/usr/bin:/bin",
  };
}

type Fn = "agy" | "usage";

/** Runs one function; spies on every file write for the reply canary. */
function call(fn: Fn, s: Scratch, file: string, env: Record<string, string> = envOf(s)): void {
  const realWrite = fs.writeFileSync;
  const spy = ((
    target: fs.PathOrFileDescriptor,
    data: string | NodeJS.ArrayBufferView,
    ...rest: unknown[]
  ) => {
    if (
      String(target) !== file &&
      String(data).includes(CANARY) &&
      String(target).startsWith(s.tmp)
    ) {
      fs.appendFileSync(s.scan, `${String(target)}\n`);
    }
    return (realWrite as (...a: unknown[]) => void)(target, data, ...rest);
  }) as typeof fs.writeFileSync;
  fs.writeFileSync = spy;
  try {
    if (fn === "agy") usageHeadlessAgyRewriteJsonResponse(file, LAUNCH, env, { cwd: REPO });
    else usageHeadlessCaptureUsageFile("copilot-cli", file, LAUNCH, env, { cwd: REPO });
  } finally {
    fs.writeFileSync = realWrite;
  }
}

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

function records(s: Scratch): string[] {
  return walk(path.join(s.usage, "journal")).filter(
    (f) => f.endsWith(".json") && !/\.(wing|attr)\.json$/.test(f),
  );
}

function seed(s: Scratch, name: string, content: Buffer | string): string {
  const f = path.join(s.work, name);
  fs.writeFileSync(f, content);
  return f;
}

describe("G15 R18 in-place rewrite", () => {
  const s = scratch();
  const out = seed(s, "agy-out.txt", fs.readFileSync(AGY_ENVELOPE));
  const want = String((JSON.parse(fs.readFileSync(AGY_ENVELOPE, "utf8")) as Json).response);
  call("agy", s, out);

  it("writes the reply to the out file byte for byte", () => {
    assert.equal(fs.readFileSync(out, "utf8"), want);
  });
  it("stores exactly one record and leaves the canary out of the usage root", () => {
    assert.equal(records(s).length, 1);
    assert.deepEqual(
      walk(s.usage).filter((f) => fs.readFileSync(f, "utf8").includes(CANARY)),
      [],
    );
  });
  it("never lets a TMPDIR file hold the reply", () => {
    assert.equal(fs.readFileSync(s.scan, "utf8"), "");
  });
  it("leaves TMPDIR empty", () => {
    assert.deepEqual(fs.readdirSync(s.tmp), []);
  });
  for (const [name, content] of [
    ["non-JSON", "agy: error: deadline exceeded"],
    ["non-string response", '{"conversation_id":"c","status":"error","response":null}\n'],
    ["empty", ""],
  ] as const) {
    it(`leaves a ${name} file byte-identical`, () => {
      const f = seed(s, `${name.replace(/\W/g, "-")}.txt`, content);
      call("agy", s, f);
      assert.equal(fs.readFileSync(f, "utf8"), content);
      assert.equal(records(s).length, 1);
    });
  }
});

describe("copilot usage file capture", () => {
  it("stores one record for a valid usage file", () => {
    const s = scratch();
    call("usage", s, seed(s, "o.txt", fs.readFileSync(COPILOT_ENVELOPE)));
    assert.equal(records(s).length, 1);
  });
  for (const [label, content] of [
    ["unparseable", "not json"],
    ["empty", ""],
  ] as const) {
    it(`leaves an ${label} usage file byte-identical and stores nothing`, () => {
      const s = scratch();
      const f = seed(s, "o.txt", content);
      call("usage", s, f);
      assert.equal(fs.readFileSync(f, "utf8"), content);
      assert.equal(records(s).length, 0);
    });
  }
});

describe("usage root resolution", () => {
  it("resolves CREWRIG_USAGE_ROOT at call time, defaulting to HOME/.crewrig/usage", () => {
    const s = scratch();
    const f = seed(s, "o.txt", fs.readFileSync(AGY_ENVELOPE));
    call("agy", s, f, { ...envOf(s), CREWRIG_USAGE_ROOT: "" });
    assert.equal(walk(path.join(s.home, ".crewrig", "usage", "journal")).length > 0, true);
  });
});
