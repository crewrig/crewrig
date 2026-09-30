// hook-entry-form.test.ts — the entry form of the usage-capture hooks and the
// silence it buys (spec 0243 R5; plan step 8, named edit v1-F5).
//
// Part 1 asserts the R5 form mechanically. Part 2 runs each entry on the
// runner's Node.js with no flag and no Node.js option in the environment and
// asserts exit 0 and zero bytes on both streams: fast path, slow path, and a
// slow path that lazily loads `scripts/lib/*.ts` (the real `hook-run.ts`
// imports `tmp-file.ts`, an ECMAScript module under a typeless root scope).
// Part 3 (v1-F5) runs the UNSTUBBED graph once per CLI, including Copilot CLI's
// `node:sqlite` slow path, which a stub never loads. Wired into the
// `usage-capture-node-24-0` capability, this suite is what proves the silence
// on Node.js 24.0.0.

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import {
  hookEnv,
  makeFixtureTree,
  NOOP_INDEX,
  REPO,
  runEntry,
  type FixtureTree,
} from "./lib/hook-fixture-tree.ts";

const ENTRIES = ["usage-capture.ts", "antigravity-statusline-shim.ts"] as const;
const FIXTURES = path.join(REPO, "scripts", "tests", "fixtures", "usage-capture");

interface Cursor {
  touchStamp(cli: string, sourcePath: string, mtimeMs: number): void;
}
const cursor = createRequire(import.meta.url)(
  path.join(REPO, "scripts", "lib", "usage-capture", "cursor.js"),
) as Cursor;

/** The entry's code, without its full-line comments (which may name `import()`). */
function code(lines: readonly string[]): string {
  return lines.filter((line) => !line.trimStart().startsWith("//")).join("\n");
}

function argsFor(entry: string): string[] {
  return entry === "usage-capture.ts" ? ["claude-code", "Stop"] : [];
}

describe("entry form (R5)", () => {
  for (const entry of ENTRIES) {
    const lines = fs.readFileSync(path.join(REPO, "hooks", entry), "utf8").split("\n");

    test(`${entry}: no module syntax or global declaration at column 0`, () => {
      const offending = lines.filter((line) =>
        /^(import|export|const|let|var|function|class|enum|interface|type|declare|namespace|abstract|async)\b/.test(
          line,
        ),
      );
      assert.deepEqual(offending, []);
    });

    test(`${entry}: the first statement removes the warning listeners`, () => {
      const first = lines.find((line) => line.trim() !== "" && !line.startsWith("//"));
      assert.equal(first, 'process.removeAllListeners("warning");');
    });

    test(`${entry}: the listeners are removed before the first import()`, () => {
      const source = code(lines);
      const removal = source.indexOf('process.removeAllListeners("warning")');
      const firstImport = source.search(/\bimport\(/);
      assert.ok(removal >= 0 && firstImport > removal);
    });

    test(`${entry}: no uncaughtException handler (it would blind --throw-deprecation)`, () => {
      assert.doesNotMatch(code(lines), /uncaughtException/);
    });
  }
});

let work: string;
let stubbed: FixtureTree;
let lazy: FixtureTree;
let n = 0;

before(() => {
  work = fs.mkdtempSync(path.join(os.tmpdir(), "crewrig-entry-form-"));
  // A stub hook-run that loads nothing, and the real hook-run over a no-op
  // dispatcher (which lazily loads scripts/lib/tmp-file.ts).
  stubbed = makeFixtureTree({ hookRun: "export async function runCapture(): Promise<void> {}\n" });
  lazy = makeFixtureTree({ index: NOOP_INDEX });
});
after(() => {
  stubbed.cleanup();
  lazy.cleanup();
  fs.rmSync(work, { recursive: true, force: true });
});

function freshRoot(): string {
  n += 1;
  return path.join(work, `r${n}`);
}

function assertSilent(res: { status: number | null; stdout: string; stderr: string }): void {
  assert.equal(res.status, 0, res.stderr);
  assert.equal(res.stdout, "");
  assert.equal(res.stderr, "");
}

function stampedTranscript(root: string): string {
  const dir = path.join(work, `t${n}`);
  fs.mkdirSync(dir, { recursive: true });
  const source = path.join(dir, "t.jsonl");
  fs.writeFileSync(source, "{}\n");
  const previous = process.env["CREWRIG_USAGE_ROOT"];
  process.env["CREWRIG_USAGE_ROOT"] = root;
  try {
    cursor.touchStamp("claude-code", source, fs.statSync(source).mtimeMs);
  } finally {
    if (previous === undefined) delete process.env["CREWRIG_USAGE_ROOT"];
    else process.env["CREWRIG_USAGE_ROOT"] = previous;
  }
  return source;
}

describe("silence on the runner's Node.js, no flag and no option (R5)", () => {
  test("usage-capture.ts, fast path", () => {
    const root = freshRoot();
    const source = stampedTranscript(root);
    assertSilent(
      runEntry(
        stubbed.file("hooks", "usage-capture.ts"),
        argsFor("usage-capture.ts"),
        JSON.stringify({ transcript_path: source }),
        hookEnv({ CREWRIG_USAGE_ROOT: root }),
      ),
    );
  });

  for (const [name, tree] of [
    ["stubbed capture step", () => stubbed],
    ["capture step that lazily loads scripts/lib/*.ts", () => lazy],
  ] as const) {
    for (const entry of ENTRIES) {
      test(`${entry}, slow path, ${name}`, () => {
        assertSilent(
          runEntry(
            tree().file("hooks", entry),
            argsFor(entry),
            JSON.stringify({ transcript_path: path.join(work, "absent.jsonl") }),
            hookEnv({ CREWRIG_USAGE_ROOT: freshRoot() }),
          ),
        );
      });
    }
  }

  test("canary: without the listener removal the lazily loaded module warns", () => {
    const bare = makeFixtureTree({ index: NOOP_INDEX });
    try {
      const entryPath = bare.file("hooks", "usage-capture.ts");
      const source = fs.readFileSync(entryPath, "utf8");
      fs.writeFileSync(
        entryPath,
        source.replace('process.removeAllListeners("warning");', "void 0;"),
      );
      const res = runEntry(
        entryPath,
        argsFor("usage-capture.ts"),
        "{}",
        hookEnv({ CREWRIG_USAGE_ROOT: freshRoot() }),
      );
      assert.equal(res.status, 0);
      assert.notEqual(res.stderr, "", "the channel is dead: nothing warns without the removal");
    } finally {
      bare.cleanup();
    }
  });
});

describe("real capture graph, every CLI's slow path (v1-F5)", () => {
  interface Run {
    root: string;
    home: string;
    env: NodeJS.ProcessEnv;
  }

  function fresh(): Run {
    const root = freshRoot();
    const home = path.join(work, `h${n}`);
    fs.mkdirSync(home, { recursive: true });
    return {
      root,
      home,
      env: hookEnv({ CREWRIG_USAGE_ROOT: root, HOME: home, USERPROFILE: home }),
    };
  }

  function journalRecords(root: string): string[] {
    const found: string[] = [];
    const walk = (dir: string): void => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/^[0-9a-f]{64}\.json$/.test(entry.name)) found.push(full);
      }
    };
    walk(path.join(root, "journal"));
    return found;
  }

  function copyFixture(run: Run, relative: string, name: string): string {
    const target = path.join(run.home, name);
    fs.copyFileSync(path.join(FIXTURES, relative), target);
    return target;
  }

  const entry = path.join(REPO, "hooks", "usage-capture.ts");

  test("claude-code", () => {
    const run = fresh();
    const transcript = copyFixture(run, "claude-code/2.1.x-jsonl/session.jsonl", "session.jsonl");
    const res = runEntry(
      entry,
      ["claude-code", "Stop"],
      JSON.stringify({ transcript_path: transcript, cwd: "/tmp/x" }),
      run.env,
    );
    assertSilent(res);
    assert.ok(journalRecords(run.root).length > 0, "a record was stored");
  });

  test("gemini-cli", () => {
    const run = fresh();
    const transcript = copyFixture(
      run,
      "gemini-cli/jsonl-set-journal/session.jsonl",
      "session.jsonl",
    );
    const res = runEntry(
      entry,
      ["gemini-cli", "AfterModel"],
      JSON.stringify({ transcript_path: transcript, cwd: "/tmp/x" }),
      run.env,
    );
    assertSilent(res);
    assert.ok(journalRecords(run.root).length > 0, "a record was stored");
  });

  test("antigravity (statusline shim)", () => {
    const run = fresh();
    const payload = fs.readFileSync(
      path.join(FIXTURES, "antigravity", "statusline-payload", "payload.json"),
      "utf8",
    );
    const res = runEntry(
      path.join(REPO, "hooks", "antigravity-statusline-shim.ts"),
      [],
      payload,
      run.env,
    );
    assertSilent(res);
    assert.ok(journalRecords(run.root).length > 0, "a record was stored");
  });

  test(
    "a version probe that warns on stderr does not reach the hook's stderr",
    { skip: process.platform === "win32" },
    () => {
      // record.js resolves `gemini` through /bin/sh and runs `gemini --version`
      // once per binary; the hook has no shell redirection around it.
      const run = fresh();
      const bin = path.join(run.home, "bin");
      fs.mkdirSync(bin, { recursive: true });
      const fake = path.join(bin, "gemini");
      fs.writeFileSync(fake, "#!/bin/sh\necho 'DeprecationWarning: punycode' >&2\necho 0.99.0\n");
      fs.chmodSync(fake, 0o755);
      const transcript = copyFixture(
        run,
        "gemini-cli/jsonl-set-journal/session.jsonl",
        "session.jsonl",
      );
      const res = runEntry(
        entry,
        ["gemini-cli", "AfterModel"],
        JSON.stringify({ transcript_path: transcript, cwd: "/tmp/x" }),
        { ...run.env, PATH: `${bin}${path.delimiter}${process.env["PATH"] ?? ""}` },
      );
      assertSilent(res);
      const version = path.join(run.root, "state", "gemini-cli", "version.json");
      assert.match(fs.readFileSync(version, "utf8"), /0\.99\.0/, "the probe did run");
    },
  );

  test("copilot-cli, through the node:sqlite slow path", () => {
    const run = fresh();
    const fixture = path.join(FIXTURES, "copilot-cli", "assistant-usage-events");
    const store = path.join(run.home, ".copilot", "session-store.db");
    fs.mkdirSync(path.dirname(store), { recursive: true });
    const db = new DatabaseSync(store);
    try {
      db.exec(fs.readFileSync(path.join(fixture, "schema.sql"), "utf8"));
      db.exec(fs.readFileSync(path.join(fixture, "rows.sql"), "utf8"));
    } finally {
      db.close();
    }
    const res = runEntry(entry, ["copilot-cli", "agentStop"], "{}", run.env);
    assertSilent(res);
    assert.ok(journalRecords(run.root).length > 0, "a record was stored from the SQLite store");
  });
});
