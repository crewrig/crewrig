// build-components-entry-form.test.ts — the entry form of scripts/build-components.ts and the
// silence it buys (spec 0250 R1, R3, R24; plan step 21).
//
// Part 1 asserts the form of spec 0243 R5 mechanically on the entry. Part 2 is the static
// contract of the sources: imports are `node:` built-ins or repository files, `js-yaml` is
// imported by no module (R24), no POSIX tool is spawned, and the floor guard comes first.
// Part 3 runs the entry UNSTUBBED in a fixture tree on the runner's Node.js with no flag and
// no option in the environment and asserts no Node.js warning reaches standard error on every
// path reachable without a failure. Part 4 is a canary: without the listener removal the lazily
// loaded graph warns, so the silence is the form's doing.
//
// Runs on Node.js 24.0.0 (the `build-components-ts-node-24-0` job, after the production
// install): nothing here uses an API newer than 24.0.0 and no spawn passes `--disable-warning`.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { createFixtureTree } from "./lib/build-fixture-tree.ts";
import { agent, CONFIG, REPO, seedMappings, skill } from "./fixtures/build-components/entry-kit.ts";

const ENTRY = "scripts/build-components.ts";
const MODULES = "scripts/lib/build-components";
const WARNING = /Warning|MODULE_TYPELESS|ExperimentalWarning|node --trace/;

/** A file's code, without its full-line comments (which may name `import()`). */
function code(file: string): string {
  return fs
    .readFileSync(path.join(REPO, file), "utf8")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
    .join("\n");
}

const moduleFiles = (): string[] =>
  fs
    .readdirSync(path.join(REPO, MODULES))
    .filter((name) => name.endsWith(".ts"))
    .map((name) => `${MODULES}/${name}`);

describe("entry form (R3)", () => {
  const lines = fs.readFileSync(path.join(REPO, ENTRY), "utf8").split("\n");

  test("no module syntax or global declaration at column 0", () => {
    const offending = lines.filter((line) =>
      /^(import|export|const|let|var|function|class|enum|interface|type|declare|namespace|abstract|async)\b/.test(
        line,
      ),
    );
    assert.deepEqual(offending, []);
  });

  test("the first statement removes the warning listeners", () => {
    const first = lines.find((line) => line.trim() !== "" && !line.startsWith("//"));
    assert.equal(first, 'process.removeAllListeners("warning");');
  });

  test("the listeners are removed before the first import()", () => {
    const text = code(ENTRY);
    const removal = text.indexOf('process.removeAllListeners("warning")');
    const firstImport = text.search(/\bimport\(/);
    assert.ok(removal >= 0 && firstImport > removal, "removal first, then the lazy import");
  });

  test("no uncaughtException handler (it would blind --throw-deprecation)", () => {
    assert.doesNotMatch(code(ENTRY), /uncaughtException/);
  });

  test("the exit status is process.exitCode, never process.exit (standard output drains)", () => {
    assert.match(code(ENTRY), /process\.exitCode\s*=/);
    for (const file of [ENTRY, ...moduleFiles()])
      assert.doesNotMatch(code(file), /process\.exit\(/, file);
  });
});

describe("static contract (R1, R24)", () => {
  const sources = (): string[] => [ENTRY, ...moduleFiles()];

  test("every import is a node: built-in or a repository file: no third-party package", () => {
    const specifier =
      /(?:^\s*(?:import|export)\b[^"'\n]*?\bfrom\s*|^\s*import\s*|\bimport\(\s*|\brequire\(\s*)["']([^"']+)["']/gm;
    let seen = 0;
    for (const file of sources()) {
      for (const match of code(file).matchAll(specifier)) {
        seen += 1;
        const spec = match[1] ?? "";
        assert.ok(spec.startsWith("node:") || spec.startsWith("."), `${file} imports ${spec}`);
      }
    }
    assert.ok(seen > 40, `only ${seen} import specifiers found: the scan is vacuous`);
  });

  test("no module names js-yaml except the one loadDependency call (R24)", () => {
    const naming = sources().filter((file) => /js-yaml/.test(code(file)));
    assert.deepEqual(naming, [`${MODULES}/main.ts`]);
    assert.match(code(`${MODULES}/main.ts`), /loadDependency\("js-yaml"\)/);
  });

  test("no POSIX utility, shell or yq is named as a command to spawn (R11)", () => {
    const forbidden =
      /["'`](bash|sh|yq|jq|sed|awk|grep|find|sort|cat|cp|mkdir|rm|ls|chmod|mktemp)["'`]/;
    for (const file of sources()) assert.doesNotMatch(code(file), forbidden, file);
    for (const file of sources()) {
      assert.doesNotMatch(
        code(file),
        /\b(spawn|spawnSync|execFile|execFileSync|exec|execSync)\(/,
        file,
      );
      assert.doesNotMatch(code(file), /shell:\s*true/, file);
    }
  });

  test("the floor guard answers first: silent on a Node.js at or above the floor", () => {
    const res = spawnSync(process.execPath, [path.join(REPO, "scripts/lib/node-floor-guard.js")], {
      encoding: "utf8",
    });
    assert.deepEqual([res.status, res.stdout, res.stderr], [0, "", ""]);
  });
});

describe("silence on the runner's Node.js, no flag and no option (R3)", () => {
  const tree = createFixtureTree();
  tree.config(CONFIG);
  tree.artifact("core/skills/probe/SKILL.md", skill("probe"));
  tree.artifact("core/agents/ag/AGENT.md", agent("ag"));
  seedMappings(tree);
  const agentSource = tree.resolve("artifacts/core/agents/ag/AGENT.md");

  const silent = (args: string[], status = 0): void => {
    const res = tree.run(args);
    assert.equal(res.status, status, `${args.join(" ")}: ${res.stderr}`);
    assert.equal(res.stderr, "", args.join(" "));
  };

  test("--list-output-dirs", () => silent(["--list-output-dirs", "--target", "claude"]));
  test("a build, every CLI", () => silent([]));
  test("--check on a tree that matches", () => silent(["--check"]));
  test("--resolve", () => silent(["--resolve", agentSource, "gemini"]));
  test("a refusal's standard error is its own diagnostic only", () => {
    tree.write("crewrig.config.toml", 'canonical_repo = "file:///x"\n');
    const res = tree.run([]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /^Error: canonical_repo in crewrig\.config\.toml is malformed/);
    assert.doesNotMatch(res.stderr, WARNING);
    tree.config(CONFIG);
  });
  test("a missing configuration warns with its own line and nothing from Node.js", () => {
    tree.remove("crewrig.config.toml");
    const res = tree.run([]);
    assert.equal(res.status, 0);
    assert.match(res.stderr, /^Warning: .*crewrig\.config\.toml not found/);
    assert.equal(res.stderr.split("\n").filter((line) => line !== "").length, 1);
    tree.config(CONFIG);
  });
});

describe("canary: without the listener removal the lazily loaded graph warns", () => {
  test("the silence is the entry form's doing", () => {
    const tree = createFixtureTree();
    const original = fs.readFileSync(tree.resolve(ENTRY), "utf8");
    const bare = original.replace('process.removeAllListeners("warning");', "void 0;");
    assert.notEqual(bare, original);
    tree.write("scripts/build-components-bare.ts", bare);
    const res = tree.run(["--list-output-dirs"], { entry: "scripts/build-components-bare.ts" });
    assert.equal(res.status, 0, "the listing still works");
    assert.match(res.stderr, WARNING, "the channel is alive: Node.js warns without the removal");
    assert.equal(tree.run(["--list-output-dirs"]).stderr, "", "and is silent with it");
  });
});
