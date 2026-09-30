// usage-capture-hook.test.ts — black-box tests of hooks/usage-capture.ts
// (spec 0243 R4-R12): guard, fast path, slow path, test override, exit-zero
// contract and the missing-dependency diagnostic.
//
// Every test runs the real entry file from a fixture checkout whose
// `hook-run.ts` is a marker stub: "graph loaded" is the marker file's
// existence, so the fast path is proved by the graph never loading.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import {
  hookEnv,
  makeFixtureTree,
  markerHookRun,
  REPO,
  runEntry,
  type FixtureTree,
} from "./lib/hook-fixture-tree.ts";

interface Cursor {
  stampPath(cli: string, sourcePath: string): string;
  sourceKey(sourcePath: string): string;
  touchStamp(cli: string, sourcePath: string, mtimeMs: number): void;
}

const realCursor = createRequire(import.meta.url)(
  path.join(REPO, "scripts", "lib", "usage-capture", "cursor.js"),
) as Cursor;

let tree: FixtureTree;
let work: string;
let n = 0;

before(() => {
  tree = makeFixtureTree({ hookRun: markerHookRun() });
  work = fs.mkdtempSync(path.join(os.tmpdir(), "crewrig-hook-test-"));
});
after(() => {
  tree.cleanup();
  fs.rmSync(work, { recursive: true, force: true });
});

interface Scenario {
  root: string;
  marker: string;
  source: string;
}

/** A fresh usage root, a marker path and a transcript at `<dir>/a/b.jsonl`. */
function scenario(): Scenario {
  n += 1;
  const dir = path.join(work, `s${n}`);
  fs.mkdirSync(path.join(dir, "a"), { recursive: true });
  const source = path.join(dir, "a", "b.jsonl");
  fs.writeFileSync(source, "{}\n");
  return { root: path.join(dir, "root"), marker: path.join(dir, "marker"), source };
}

function stamp(sc: Scenario, cli = "claude-code", source = sc.source): void {
  const previous = process.env["CREWRIG_USAGE_ROOT"];
  process.env["CREWRIG_USAGE_ROOT"] = sc.root;
  try {
    realCursor.touchStamp(cli, source, fs.statSync(source).mtimeMs);
  } finally {
    if (previous === undefined) delete process.env["CREWRIG_USAGE_ROOT"];
    else process.env["CREWRIG_USAGE_ROOT"] = previous;
  }
}

function fire(
  sc: Scenario,
  payload: string,
  cli = "claude-code",
  extra: Record<string, string> = {},
) {
  return runEntry(
    tree.file("hooks", "usage-capture.ts"),
    [cli, "Stop"],
    payload,
    hookEnv({ CREWRIG_USAGE_ROOT: sc.root, MARKER: sc.marker, ...extra }),
  );
}

function graphLoaded(sc: Scenario): boolean {
  return fs.existsSync(sc.marker);
}

function silentSuccess(res: { status: number | null; stdout: string; stderr: string }): void {
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout, "");
  assert.equal(res.stderr, "");
}

describe("guard (R6)", () => {
  test("fresh stamp, source not newer: fast path, graph never loaded", () => {
    const sc = scenario();
    stamp(sc);
    silentSuccess(fire(sc, JSON.stringify({ transcript_path: sc.source })));
    assert.equal(graphLoaded(sc), false);
  });

  test("the transcriptPath spelling is honoured", () => {
    const sc = scenario();
    stamp(sc);
    silentSuccess(fire(sc, JSON.stringify({ transcriptPath: sc.source })));
    assert.equal(graphLoaded(sc), false);
  });

  test("source newer than the stamp: slow path", () => {
    const sc = scenario();
    stamp(sc);
    const later = new Date(Date.now() + 5000);
    fs.utimesSync(sc.source, later, later);
    silentSuccess(fire(sc, JSON.stringify({ transcript_path: sc.source })));
    assert.ok(graphLoaded(sc));
  });

  test("no stamp: slow path", () => {
    const sc = scenario();
    silentSuccess(fire(sc, JSON.stringify({ transcript_path: sc.source })));
    assert.ok(graphLoaded(sc));
  });

  test("the escaped JSON separator is decoded before the stamp is keyed", () => {
    const sc = scenario();
    stamp(sc);
    const escaped = JSON.stringify({ transcript_path: sc.source }).replace(
      /([\\/])b\.jsonl/,
      "\\/b.jsonl",
    );
    // On POSIX the raw text carries `a\/b.jsonl`; on Windows the separators
    // are already the escaped `\\` of JSON.stringify.
    if (process.platform !== "win32") assert.ok(escaped.includes("a\\/b.jsonl"), escaped);
    silentSuccess(fire(sc, escaped));
    assert.equal(graphLoaded(sc), false);
  });

  test("a Windows-style path is keyed on its decoded string, not the raw text", () => {
    const sc = scenario();
    const decoded = String.raw`C:\Users\x\t.jsonl`;
    const raw = `{"transcript_path":"C:\\\\Users\\\\x\\\\t.jsonl"}`;
    assert.equal((JSON.parse(raw) as { transcript_path: string }).transcript_path, decoded);
    // Off Windows the path is not absolute, so capture runs; on Windows the
    // file would have to exist. Either way the raw text never keys a stamp.
    silentSuccess(fire(sc, raw));
    assert.equal(realCursor.sourceKey(decoded).length, 64);
    if (process.platform !== "win32") assert.ok(graphLoaded(sc));
  });

  const fallThrough: Array<[string, (sc: Scenario) => string]> = [
    ["a payload that is not JSON", () => "transcript_path: not json"],
    ["an empty payload", () => ""],
    ["a JSON array", () => "[1,2]"],
    ["a JSON null", () => "null"],
    ["a nested-only key", (sc) => JSON.stringify({ event: { transcript_path: sc.source } })],
    ["no path key", () => JSON.stringify({ session_id: "x" })],
    ["a non-string path", () => JSON.stringify({ transcript_path: 7 })],
    ["an empty path", () => JSON.stringify({ transcript_path: "" })],
    ["a relative path", () => JSON.stringify({ transcript_path: "relative/p.jsonl" })],
    [
      "a path to a missing file",
      (sc) => JSON.stringify({ transcript_path: path.join(path.dirname(sc.source), "gone.jsonl") }),
    ],
    ["a directory", (sc) => JSON.stringify({ transcript_path: path.dirname(sc.source) })],
  ];
  for (const [name, payload] of fallThrough) {
    test(`${name}: capture runs, silent, exit 0`, () => {
      const sc = scenario();
      stamp(sc);
      silentSuccess(fire(sc, payload(sc)));
      assert.ok(graphLoaded(sc));
    });
  }

  test("both keys present and different: the stamp is keyed on transcript_path", () => {
    const sc = scenario();
    stamp(sc);
    const other = path.join(path.dirname(sc.source), "other.jsonl");
    fs.writeFileSync(other, "{}\n");
    // transcript_path (stamped) wins: fast path. Swapped: no stamp for it, capture.
    silentSuccess(fire(sc, JSON.stringify({ transcript_path: sc.source, transcriptPath: other })));
    assert.equal(graphLoaded(sc), false);
    silentSuccess(fire(sc, JSON.stringify({ transcript_path: other, transcriptPath: sc.source })));
    assert.ok(graphLoaded(sc));
  });

  test("copilot-cli keys on the fixed store under the home directory", () => {
    const sc = scenario();
    const home = path.join(path.dirname(sc.source), "home");
    const store = path.join(home, ".copilot", "session-store.db");
    fs.mkdirSync(path.dirname(store), { recursive: true });
    fs.writeFileSync(store, "");
    const homeEnv = { HOME: home, USERPROFILE: home };
    silentSuccess(fire(sc, "{}", "copilot-cli", homeEnv));
    assert.ok(graphLoaded(sc), "no stamp yet: capture");
    fs.rmSync(sc.marker);
    stamp(sc, "copilot-cli", store);
    silentSuccess(fire(sc, "{}", "copilot-cli", homeEnv));
    assert.equal(graphLoaded(sc), false, "stamp present, store not newer: fast path");
  });

  test("without CREWRIG_USAGE_ROOT the usage root is .crewrig/usage under the home directory (R8)", () => {
    const sc = scenario();
    const home = path.join(path.dirname(sc.source), "home");
    const env = hookEnv({ HOME: home, USERPROFILE: home, MARKER: sc.marker });
    delete env["CREWRIG_USAGE_ROOT"];
    const payload = JSON.stringify({ transcript_path: sc.source });
    const run = () =>
      runEntry(tree.file("hooks", "usage-capture.ts"), ["claude-code", "Stop"], payload, env);

    silentSuccess(run());
    assert.ok(graphLoaded(sc), "no stamp under the home directory yet: capture");

    fs.rmSync(sc.marker);
    stamp({ ...sc, root: path.join(home, ".crewrig", "usage") });
    silentSuccess(run());
    assert.equal(graphLoaded(sc), false, "stamp under <home>/.crewrig/usage: fast path");
  });

  test("the stamp key is the SHA-256 hex digest of the decoded source path", () => {
    const sc = scenario();
    stamp(sc);
    const digest = createHash("sha256").update(sc.source).digest("hex");
    assert.ok(fs.existsSync(path.join(sc.root, "state", "claude-code", `${digest}.stamp`)));
  });
});

describe("payload and arguments (R4)", () => {
  test("cli and event reach the capture step verbatim", () => {
    const sc = scenario();
    silentSuccess(fire(sc, "{}", "gemini-cli"));
    assert.match(fs.readFileSync(sc.marker, "utf8"), /run gemini-cli Stop\n/);
  });
});

describe("standard input (R4, R5)", () => {
  const cases: Array<
    [string, (entry: string, env: NodeJS.ProcessEnv) => ReturnType<typeof runEntry>]
  > = [
    [
      "a payload larger than one pipe buffer",
      (e, env) =>
        runEntry(e, ["claude-code", "Stop"], JSON.stringify({ pad: "x".repeat(300_000) }), env),
    ],
    ["/dev/null", (e, env) => runEntry(e, ["claude-code", "Stop"], null, env)],
    ["an empty pipe", (e, env) => runEntry(e, ["claude-code", "Stop"], "", env)],
  ];
  for (const [name, run] of cases) {
    test(`${name}: exit 0, silent, capture still runs`, () => {
      const sc = scenario();
      const res = run(
        tree.file("hooks", "usage-capture.ts"),
        hookEnv({ CREWRIG_USAGE_ROOT: sc.root, MARKER: sc.marker }),
      );
      silentSuccess(res);
      assert.ok(graphLoaded(sc));
    });
  }

  test(
    "a closed standard input: exit 0, silent, capture still runs",
    { skip: process.platform === "win32" },
    () => {
      const sc = scenario();
      const res = spawnSync(
        "sh",
        [
          "-c",
          'exec "$0" "$1" claude-code Stop <&-',
          process.execPath,
          tree.file("hooks", "usage-capture.ts"),
        ],
        { encoding: "utf8", env: hookEnv({ CREWRIG_USAGE_ROOT: sc.root, MARKER: sc.marker }) },
      );
      silentSuccess({ status: res.status, stdout: res.stdout, stderr: res.stderr });
      assert.ok(graphLoaded(sc));
    },
  );
});

describe("failure never reaches the CLI (R5)", () => {
  test("a capture step that throws: exit 0, silent", () => {
    const failing = makeFixtureTree({
      hookRun: 'export async function runCapture(): Promise<void> { throw new Error("boom"); }\n',
    });
    try {
      const sc = scenario();
      silentSuccess(
        runEntry(
          failing.file("hooks", "usage-capture.ts"),
          ["claude-code", "Stop"],
          "{}",
          hookEnv({ CREWRIG_USAGE_ROOT: sc.root }),
        ),
      );
    } finally {
      failing.cleanup();
    }
  });

  test("a hook-run module that fails to load: exit 0, silent", () => {
    const broken = makeFixtureTree({ hookRun: 'throw new Error("load failure");\n' });
    try {
      const sc = scenario();
      silentSuccess(
        runEntry(
          broken.file("hooks", "usage-capture.ts"),
          ["claude-code", "Stop"],
          "{}",
          hookEnv({ CREWRIG_USAGE_ROOT: sc.root }),
        ),
      );
    } finally {
      broken.cleanup();
    }
  });

  test("an unwritable usage root: exit 0, silent (real dispatcher)", () => {
    const sc = scenario();
    fs.writeFileSync(sc.root, "a file where a directory is expected");
    const res = runEntry(
      path.join(REPO, "hooks", "usage-capture.ts"),
      ["claude-code", "Stop"],
      JSON.stringify({ transcript_path: sc.source }),
      hookEnv({ CREWRIG_USAGE_ROOT: sc.root }),
    );
    silentSuccess(res);
  });
});

describe("missing dependency (R12)", () => {
  test("one line on stderr naming the package, exit 1, no resolution error", () => {
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
      const sc = scenario();
      const res = runEntry(
        missing.file("hooks", "usage-capture.ts"),
        ["claude-code", "Stop"],
        "{}",
        hookEnv({ CREWRIG_USAGE_ROOT: sc.root }),
      );
      assert.equal(res.status, 1);
      assert.equal(res.stdout, "");
      assert.match(
        res.stderr,
        /^crewrig: required package 'crewrig-absent-package' is not installed — re-run setup/,
      );
      assert.equal(res.stderr.trimEnd().split("\n").length, 1, res.stderr);
      assert.doesNotMatch(res.stderr, /ERR_MODULE_NOT_FOUND|Cannot find/);
    } finally {
      missing.cleanup();
    }
  });
});

describe("test-only override (R9, R10)", () => {
  let overrideTree: FixtureTree;
  before(() => {
    overrideTree = makeFixtureTree(); // real hook-run.ts, no-op dispatcher
  });
  after(() => overrideTree.cleanup());

  /** An override script that copies the staged payload and records its arguments and mode. */
  function recorder(dir: string): string {
    const script = path.join(dir, "override.js");
    fs.writeFileSync(
      script,
      [
        "const fs = require('fs');",
        "const argv = process.argv.slice(2);",
        "const file = argv[argv.indexOf('--payload-file') + 1];",
        "fs.writeFileSync(process.env.OUT, JSON.stringify({",
        "  argv: argv.slice(0, 4), file,",
        "  content: fs.readFileSync(file, 'utf8'),",
        "  mode: fs.statSync(file).mode & 0o777,",
        "}));",
        "",
      ].join("\n"),
    );
    return script;
  }

  function runOverride(payload: string, env: Record<string, string>) {
    const sc = scenario();
    const tmp = path.join(path.dirname(sc.source), "tmp");
    fs.mkdirSync(tmp);
    const out = path.join(path.dirname(sc.source), "out.json");
    const res = runEntry(
      overrideTree.file("hooks", "usage-capture.ts"),
      ["claude-code", "Stop"],
      payload,
      hookEnv({
        CREWRIG_USAGE_ROOT: sc.root,
        OUT: out,
        TMPDIR: tmp,
        TEMP: tmp,
        TMP: tmp,
        CREWRIG_USAGE_CAPTURE_CLI: recorder(path.dirname(sc.source)),
        ...env,
      }),
    );
    return { res, tmp, out };
  }

  test("the payload is staged in an owner-only file in the temp directory and removed", () => {
    const payload = JSON.stringify({ session_id: "s", note: "secret-ish" });
    const { res, tmp, out } = runOverride(payload, { CREWRIG_USAGE_CAPTURE_TEST: "1" });
    silentSuccess(res);
    const seen = JSON.parse(fs.readFileSync(out, "utf8")) as {
      argv: string[];
      file: string;
      content: string;
      mode: number;
    };
    assert.deepEqual(seen.argv, ["--cli", "claude-code", "--event", "Stop"]);
    assert.equal(seen.content, payload);
    assert.equal(path.dirname(seen.file), tmp);
    if (process.platform !== "win32") assert.equal(seen.mode, 0o600);
    assert.deepEqual(fs.readdirSync(tmp), [], "the staged payload file is removed");
  });

  test("the override is ignored when CREWRIG_USAGE_CAPTURE_TEST is empty", () => {
    const { res, out, tmp } = runOverride("{}", { CREWRIG_USAGE_CAPTURE_TEST: "" });
    silentSuccess(res);
    assert.equal(fs.existsSync(out), false);
    assert.deepEqual(fs.readdirSync(tmp), []);
  });

  test("a nonexistent and a throwing override: exit 0, silent, nothing left behind", () => {
    const missing = runOverride("{}", {
      CREWRIG_USAGE_CAPTURE_TEST: "1",
      CREWRIG_USAGE_CAPTURE_CLI: "/no/such/cli.js",
    });
    silentSuccess(missing.res);
    assert.deepEqual(fs.readdirSync(missing.tmp), []);
    const sc = scenario();
    const thrower = path.join(path.dirname(sc.source), "throw.js");
    fs.writeFileSync(thrower, "throw new Error('deliberate');\n");
    const { res, tmp } = runOverride("{}", {
      CREWRIG_USAGE_CAPTURE_TEST: "1",
      CREWRIG_USAGE_CAPTURE_CLI: thrower,
    });
    silentSuccess(res);
    assert.deepEqual(fs.readdirSync(tmp), []);
  });

  test("the default path leaves no file holding the payload outside the usage root", () => {
    const sc = scenario();
    const tmp = path.join(path.dirname(sc.source), "tmp");
    fs.mkdirSync(tmp);
    const sentinel = "PAYLOAD-SENTINEL-1326";
    const res = runEntry(
      path.join(REPO, "hooks", "usage-capture.ts"),
      ["claude-code", "Stop"],
      JSON.stringify({ transcript_path: sc.source, note: sentinel }),
      hookEnv({ CREWRIG_USAGE_ROOT: sc.root, TMPDIR: tmp, TEMP: tmp, TMP: tmp }),
    );
    silentSuccess(res);
    assert.deepEqual(fs.readdirSync(tmp), []);
  });
});
