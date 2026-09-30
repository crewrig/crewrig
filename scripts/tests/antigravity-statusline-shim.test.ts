// antigravity-statusline-shim.test.ts — black-box tests of
// hooks/antigravity-statusline-shim.ts (spec 0243 R13, R14; scenarios
// "The statusline with no prior command shows nothing" and "keeps the prior
// command's display").
//
// Each test runs the real entry from a fixture checkout whose `hook-run.ts` is
// a marker stub, so "capture still runs" is the marker's content. The prior
// commands are `node -e` one-liners, which every supported platform's default
// command interpreter can start.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import {
  hookEnv,
  makeFixtureTree,
  markerHookRun,
  runEntry,
  type FixtureTree,
} from "./lib/hook-fixture-tree.ts";

let tree: FixtureTree;
let work: string;
let n = 0;

before(() => {
  tree = makeFixtureTree({ hookRun: markerHookRun() });
  work = fs.mkdtempSync(path.join(os.tmpdir(), "crewrig-statusline-test-"));
});
after(() => {
  tree.cleanup();
  fs.rmSync(work, { recursive: true, force: true });
});

const PAYLOAD = JSON.stringify({ session_id: "s1", model: { id: "m" } });

function node(script: string): string {
  const exe = JSON.stringify(process.execPath);
  return `${exe} -e ${JSON.stringify(script)}`;
}

interface Fixture {
  root: string;
  marker: string;
}

function fixture(marker?: string | null): Fixture {
  n += 1;
  const dir = path.join(work, `s${n}`);
  const root = path.join(dir, "root");
  fs.mkdirSync(path.join(root, "state"), { recursive: true });
  if (marker !== undefined && marker !== null) {
    fs.writeFileSync(path.join(root, "state", "antigravity-statusline.json"), marker);
  }
  return { root, marker: path.join(dir, "capture-marker") };
}

function fire(fx: Fixture, input: string | null = PAYLOAD) {
  return runEntry(
    tree.file("hooks", "antigravity-statusline-shim.ts"),
    [],
    input,
    hookEnv({ CREWRIG_USAGE_ROOT: fx.root, MARKER: fx.marker }),
  );
}

function captured(fx: Fixture): boolean {
  return (
    fs.existsSync(fx.marker) &&
    fs.readFileSync(fx.marker, "utf8").includes("run antigravity statusline\n")
  );
}

describe("no prior command (R13)", () => {
  const markers: Array<[string, string | null]> = [
    ["no marker file", null],
    ["a malformed marker file", "{not json"],
    ["a marker that is not an object", "[1]"],
    ["a null marker", "null"],
    ["a missing priorStatusLineCommand", "{}"],
    ["an empty priorStatusLineCommand", JSON.stringify({ priorStatusLineCommand: "" })],
    ["a non-string priorStatusLineCommand", JSON.stringify({ priorStatusLineCommand: 7 })],
  ];
  for (const [name, content] of markers) {
    test(`${name}: nothing on stdout or stderr, capture runs, exit 0`, () => {
      const fx = fixture(content);
      const res = fire(fx);
      assert.equal(res.status, 0, res.stderr);
      assert.equal(res.stdout, "");
      assert.equal(res.stderr, "");
      assert.ok(captured(fx));
    });
  }
});

describe("prior command (R13, R14)", () => {
  test("its stdout is forwarded byte for byte and it receives the payload", () => {
    const fx = fixture(
      JSON.stringify({
        priorStatusLineCommand: node(
          "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>process.stdout.write('prior:'+d.length+'\\n'))",
        ),
      }),
    );
    const res = fire(fx);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stdout, `prior:${PAYLOAD.length}\n`);
    assert.equal(res.stderr, "");
    assert.ok(captured(fx));
  });

  test("its stderr passes through unchanged", () => {
    const fx = fixture(
      JSON.stringify({ priorStatusLineCommand: node("process.stderr.write('from-prior')") }),
    );
    const res = fire(fx);
    assert.equal(res.status, 0);
    assert.equal(res.stderr, "from-prior");
    assert.ok(captured(fx));
  });

  test("a prior command that prints then exits non-zero: line kept, capture runs, exit 0", () => {
    const fx = fixture(
      JSON.stringify({
        priorStatusLineCommand: node("process.stdout.write('kept\\n');process.exit(3)"),
      }),
    );
    const res = fire(fx);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stdout, "kept\n");
    assert.ok(captured(fx));
  });

  test("a prior command that closes stdin early does not change status, output or capture", () => {
    const fx = fixture(
      JSON.stringify({
        priorStatusLineCommand: node("process.stdout.write('early\\n');process.exit(0)"),
      }),
    );
    const big = JSON.stringify({ pad: "x".repeat(2_000_000) });
    const res = fire(fx, big);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stdout, "early\n");
    assert.ok(captured(fx));
  });

  test("a prior command that cannot be started: exit 0, capture runs", () => {
    const fx = fixture(JSON.stringify({ priorStatusLineCommand: "crewrig-no-such-command-1326" }));
    const res = fire(fx);
    assert.equal(res.status, 0);
    assert.equal(res.stdout, "");
    assert.ok(captured(fx));
  });

  test("a prior command that never reads stdin does not deadlock a large payload", () => {
    const fx = fixture(
      JSON.stringify({ priorStatusLineCommand: node("process.stdout.write('ok')") }),
    );
    const res = fire(fx, JSON.stringify({ pad: "y".repeat(500_000) }));
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stdout, "ok");
  });
});

describe("standard input and failure (R5, R14)", () => {
  for (const [name, input] of [
    ["/dev/null", null],
    ["an empty pipe", ""],
  ] as const) {
    test(`${name}: exit 0, silent, capture runs`, () => {
      const fx = fixture(null);
      const res = fire(fx, input);
      assert.equal(res.status, 0, res.stderr);
      assert.equal(res.stdout, "");
      assert.equal(res.stderr, "");
      assert.ok(captured(fx));
    });
  }

  test("a capture step that throws: exit 0, silent", () => {
    const failing = makeFixtureTree({
      hookRun: 'export async function runCapture(): Promise<void> { throw new Error("boom"); }\n',
    });
    try {
      const fx = fixture(null);
      const res = runEntry(
        failing.file("hooks", "antigravity-statusline-shim.ts"),
        [],
        PAYLOAD,
        hookEnv({ CREWRIG_USAGE_ROOT: fx.root }),
      );
      assert.equal(res.status, 0);
      assert.equal(res.stdout, "");
      assert.equal(res.stderr, "");
    } finally {
      failing.cleanup();
    }
  });

  test("a MissingDependencyError still exits 0 with nothing on stderr (D2)", () => {
    const missing = makeFixtureTree({
      packageJson: {
        name: "fixture",
        private: true,
        dependencies: { "crewrig-absent-package": "1.0.0" },
      },
      hookRun: [
        'import { loadDependency } from "../require-dependency.ts";',
        "export async function runCapture(): Promise<void> {",
        '  await loadDependency("crewrig-absent-package");',
        "}",
        "",
      ].join("\n"),
    });
    try {
      const fx = fixture(null);
      const res = runEntry(
        missing.file("hooks", "antigravity-statusline-shim.ts"),
        [],
        PAYLOAD,
        hookEnv({ CREWRIG_USAGE_ROOT: fx.root }),
      );
      assert.equal(res.status, 0);
      assert.equal(res.stderr, "");
    } finally {
      missing.cleanup();
    }
  });
});
