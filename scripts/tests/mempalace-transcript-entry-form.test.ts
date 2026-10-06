// mempalace-transcript-entry-form.test.ts — the entry form of
// hooks/mempalace-transcript.ts and what it buys (spec 0247 R1, R7, R18).
//
// Part 1 asserts the form of spec 0243 R5 mechanically. Part 2 runs the real
// entry on the runner's Node.js with no flag and no Node.js option and asserts
// silence on every path, the slow path included (it lazily loads ECMAScript
// `.ts` modules under a typeless root `package.json`). Part 3 runs a copy of
// the hook in a throwaway tree whose `run.ts` is swapped for a stub: a marker
// stub proves the module graph is not loaded on the cheap paths (the budget
// canary of R7/R19), and a stub that loads an absent declared package through
// scripts/lib/require-dependency.ts proves the R18 path.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import {
  daemonEnv,
  HOOK_TS,
  makeHome,
  runHook,
  startStub,
  writeToken,
  type Stub,
} from "./lib/transcript-runtime.ts";
import { cleanupAll, realTmp, REPO } from "./lib/worktree-fixtures.ts";

const SOURCE = fs.readFileSync(HOOK_TS, "utf8").split("\n");
const PROMPT = JSON.stringify({ hook_event_name: "UserPromptSubmit", prompt: "hi", cwd: "/w/p" });

/** The entry's code, without its full-line comments (which may name `import()`). */
const code = (lines: readonly string[]): string =>
  lines.filter((line) => !line.trimStart().startsWith("//")).join("\n");

describe("entry form (R1, spec 0243 R5)", () => {
  test("no module syntax or global declaration at column 0", () => {
    const offending = SOURCE.filter((line) =>
      /^(import|export|const|let|var|function|class|enum|interface|type|declare|namespace|abstract|async)\b/.test(
        line,
      ),
    );
    assert.deepEqual(offending, []);
  });

  test("the first statement removes the warning listeners", () => {
    const first = SOURCE.find((line) => line.trim() !== "" && !line.startsWith("//"));
    assert.equal(first, 'process.removeAllListeners("warning");');
  });

  test("the module graph is reached only through one lazy import() of run.ts", () => {
    const imports = [...code(SOURCE).matchAll(/\bimport\(\s*["']([^"']+)["']/g)].map((m) => m[1]);
    assert.deepEqual(imports, ["../scripts/lib/mempalace-transcript/run.ts"]);
    assert.doesNotMatch(code(SOURCE), /\brequire\(/);
  });

  test("no uncaughtException handler (it would blind --throw-deprecation)", () => {
    assert.doesNotMatch(code(SOURCE), /uncaughtException/);
  });

  test("the hook's modules import only node: built-ins or repository files (R17)", () => {
    const dir = path.join(REPO, "scripts", "lib", "mempalace-transcript");
    const files = [
      ...fs.readdirSync(dir).map((f) => path.join(dir, f)),
      path.join(REPO, "scripts", "lib", "tls-env.ts"),
    ];
    for (const file of files) {
      const found = [
        ...code(fs.readFileSync(file, "utf8").split("\n")).matchAll(/\bfrom\s*["']([^"']+)["']/g),
      ];
      for (const [, spec] of found)
        assert.ok(spec!.startsWith("node:") || spec!.startsWith("."), `${file}: ${spec}`);
    }
  });
});

let stub: Stub;
let home: string;
let token: string;

before(async () => {
  stub = await startStub("ok");
  home = makeHome();
  token = writeToken(path.join(home, "t"));
});
after(async () => {
  await stub.stop();
  cleanupAll();
});

describe("silence on the runner's Node.js, no flag and no option (R1)", () => {
  const cases: Array<[string, string[], string, Record<string, string>]> = [
    ["disabled legacy form", [], PROMPT, {}],
    ["PostToolUse", ["claude-code"], JSON.stringify({ hook_event_name: "PostToolUse" }), {}],
    ["malformed payload", ["claude-code"], "{bad", {}],
    ["slow path, persisted, quiet", ["claude-code"], PROMPT, { MEMPALACE_TRANSCRIPT_QUIET: "1" }],
    ["slow path, nothing to record", ["gemini-cli"], "{}", {}],
  ];
  for (const [name, args, input, extra] of cases) {
    test(name, () => {
      const res = runHook(args, input, { env: daemonEnv(home, stub.port, token, extra) });
      assert.equal(res.status, 0);
      assert.equal(res.stdout, "");
      assert.equal(res.stderr, "");
    });
  }
});

describe("canary: the silence is the listener removal's doing (R1)", () => {
  test("without the removal, the lazily loaded graph warns on stderr", () => {
    const entry = tree(
      fs.readFileSync(path.join(REPO, "scripts", "lib", "mempalace-transcript", "run.ts"), "utf8"),
    );
    fs.writeFileSync(
      entry,
      fs.readFileSync(entry, "utf8").replace('process.removeAllListeners("warning");', "void 0;"),
    );
    const res = runHook(["claude-code"], PROMPT, {
      entry,
      env: daemonEnv(home, stub.port, token, { MEMPALACE_TRANSCRIPT_QUIET: "1" }),
    });
    assert.equal(res.status, 0);
    assert.match(res.stderr, /Warning/, "the channel is dead: nothing warns without the removal");
  });
});

/** A copy of the hook and scripts/lib in a throwaway tree, `run.ts` replaced by `runTs`. */
function tree(runTs: string, packageJson: object = { name: "fixture", private: true }): string {
  const root = realTmp("crewrig-mt-tree-");
  fs.mkdirSync(path.join(root, ".git"));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify(packageJson));
  fs.mkdirSync(path.join(root, "hooks"));
  fs.copyFileSync(HOOK_TS, path.join(root, "hooks", "mempalace-transcript.ts"));
  fs.cpSync(path.join(REPO, "scripts", "lib"), path.join(root, "scripts", "lib"), {
    recursive: true,
  });
  fs.writeFileSync(path.join(root, "scripts", "lib", "mempalace-transcript", "run.ts"), runTs);
  return path.join(root, "hooks", "mempalace-transcript.ts");
}

const MARKER_RUN = [
  'import fs from "node:fs";',
  'fs.writeFileSync(process.env["RUN_MARKER"] as string, "loaded\\n");',
  "export async function runTranscript(): Promise<void> {}",
  "",
].join("\n");

describe("run.ts is loaded only past the cheap guard (R7, budget canary)", () => {
  let entry: string;
  let marker: string;
  before(() => {
    entry = tree(MARKER_RUN);
    marker = path.join(realTmp("crewrig-mt-marker-"), "marker");
  });

  function loaded(args: string[], input: string, extra: Record<string, string> = {}): boolean {
    fs.rmSync(marker, { force: true });
    const res = runHook(args, input, {
      entry,
      env: daemonEnv(home, stub.port, token, { RUN_MARKER: marker, ...extra }),
    });
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stderr, "");
    return fs.existsSync(marker);
  }

  test("canary: a recordable payload loads the stub", () =>
    assert.equal(loaded(["claude-code"], PROMPT), true));
  test("PostToolUse does not load it", () =>
    assert.equal(
      loaded(["claude-code"], JSON.stringify({ hook_event_name: "PostToolUse", prompt: "x" })),
      false,
    ));
  test("Antigravity PostToolUse event argument does not load it", () =>
    assert.equal(loaded(["antigravity-cli", "PostToolUse"], "{}"), false));
  test("a disabled run does not load it", () => assert.equal(loaded([], PROMPT), false));
  test("the kill-switch does not load it", () =>
    assert.equal(loaded(["claude-code"], PROMPT, { MEMPALACE_TRANSCRIPT_ENABLED: "0" }), false));
  test("a malformed payload does not load it", () =>
    assert.equal(loaded(["claude-code"], "[1]"), false));
  test("a wrong-arity CLI identifier does not load it", () => {
    fs.rmSync(marker, { force: true });
    runHook(["claude-code", "Stop"], PROMPT, {
      entry,
      env: daemonEnv(home, stub.port, token, { RUN_MARKER: marker }),
    });
    assert.equal(fs.existsSync(marker), false);
  });
});

describe("a MissingDependencyError (R18)", () => {
  const absent = "crewrig-absent-package";
  const message = `crewrig: required package '${absent}' is not installed — re-run setup (e.g. task setup-claude-interactive).`;
  let entry: string;
  before(() => {
    entry = tree(
      [
        'import { loadDependency } from "../require-dependency.ts";',
        `await loadDependency(${JSON.stringify(absent)});`,
        "export async function runTranscript(): Promise<void> {}",
        "",
      ].join("\n"),
      { name: "fixture", private: true, dependencies: { [absent]: "1.0.0" } },
    );
  });

  test("direct form: the diagnostic alone on stderr, exit 1, nothing on stdout", () => {
    const res = runHook(["claude-code"], PROMPT, { entry, env: daemonEnv(home, stub.port, token) });
    assert.equal(res.status, 1);
    assert.equal(res.stderr, `${message}\n`);
    assert.equal(res.stdout, "");
  });

  test("Antigravity mode: the acknowledgement is still written, exit 1, never 2", () => {
    for (const args of [["antigravity-cli", "Stop"], ["Stop"]]) {
      const res = runHook(args, PROMPT, {
        entry,
        env: daemonEnv(home, stub.port, token, { MEMPALACE_TRANSCRIPT_ENABLED: "1" }),
      });
      assert.equal(res.status, 1, res.stderr);
      assert.equal(res.stdout, "{}\n");
      assert.equal(res.stderr, `${message}\n`);
      assert.doesNotMatch(res.stderr, /ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND|\n\s+at /);
    }
  });

  test("any other error from the graph still ends with status 0 and the acknowledgement (R5, R6)", () => {
    const other = tree(
      'throw new Error("boom");\nexport async function runTranscript(): Promise<void> {}\n',
    );
    const res = runHook(["antigravity-cli", "Stop"], PROMPT, {
      entry: other,
      env: daemonEnv(home, stub.port, token),
    });
    assert.equal(res.status, 0);
    assert.equal(res.stdout, "{}\n");
  });
});
