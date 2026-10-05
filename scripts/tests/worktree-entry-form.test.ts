// worktree-entry-form.test.ts — the entry form of the two entries and the
// silence it buys (spec 0248 R1, R10, R12, R24, R25; plan verification
// duties 2 and 8).
//
// Part 1 asserts the form of spec 0243 R5 mechanically on hooks/worktree-git-guard.ts
// and scripts/worktree-claim.ts. Part 2 is the static contract of the sources:
// imports are `node:` built-ins or repository files, no POSIX utility is
// named, no file exceeds the 300-line warning threshold. Part 3 runs both
// entries UNSTUBBED on the runner's Node.js with no flag and no option in the
// environment and asserts no Node.js warning reaches either stream; wired into
// the `worktree-guard-node-24-0` capability, this suite is what proves the
// silence on Node.js 24.0.0. Part 4 is a canary: without the listener removal
// the lazily loaded graph warns, so the silence is the form's doing.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import { allowed, payload, refusal, refused } from "./lib/guard-asserts.ts";
import { makeGuardTree } from "./lib/guard-tree.ts";
import {
  cleanEnv,
  cleanupAll,
  makeFixture,
  REPO,
  runClaim,
  runGuard,
  runNode,
  writeClaim,
  type Fixture,
} from "./lib/worktree-fixtures.ts";

const ENTRIES = [
  path.join("hooks", "worktree-git-guard.ts"),
  path.join("scripts", "worktree-claim.ts"),
] as const;
const CLAIM_LIB = path.join(REPO, "scripts", "lib", "worktree-claim");

after(cleanupAll);

/** A file's code, without its full-line comments (which may name `import()`). */
function code(file: string): string {
  return fs
    .readFileSync(path.join(REPO, file), "utf8")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\/\*|\*)/.test(line))
    .join("\n");
}

describe("entry form (R10, R25)", () => {
  for (const entry of ENTRIES) {
    const lines = fs.readFileSync(path.join(REPO, entry), "utf8").split("\n");

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
      const source = code(entry);
      const removal = source.indexOf('process.removeAllListeners("warning")');
      const firstImport = source.search(/\bimport\(/);
      assert.ok(removal >= 0);
      assert.ok(firstImport === -1 || firstImport > removal);
    });

    test(`${entry}: no uncaughtException handler (it would blind --throw-deprecation)`, () => {
      assert.doesNotMatch(code(entry), /uncaughtException/);
    });
  }
});

describe("static contract (R1, R12, R24)", () => {
  const libSources = (): string[] =>
    fs
      .readdirSync(CLAIM_LIB)
      .filter((name) => name.endsWith(".ts"))
      .map((name) => path.join("scripts", "lib", "worktree-claim", name));
  const sources = (): string[] => [...ENTRIES, ...libSources()];

  test("the claim modules exist", () => {
    assert.ok(libSources().length >= 10, libSources().join(", "));
  });

  test("every import is a node: built-in or a repository file: no third-party package (R12)", () => {
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
    assert.ok(seen > 15, `only ${seen} import specifiers found: the scan is vacuous`);
  });

  test("no POSIX utility, shell or jq is named as a command to spawn (R12, R24)", () => {
    const forbidden = /["'`](bash|sh|jq|date|tail|cut|wc|tr|cat|mkdir|rm|ls|sed|awk|grep|env)["'`]/;
    for (const file of sources()) {
      assert.doesNotMatch(code(file), forbidden, file);
    }
  });

  test("no spawned process asks for a shell (R22: never `shell: true`, never exec)", () => {
    for (const file of sources()) {
      const text = code(file);
      assert.doesNotMatch(text, /shell:\s*true/, file);
      assert.doesNotMatch(text, /\b(exec|execSync)\(/, file);
    }
  });

  test("no TypeScript file the ticket adds exceeds the 300-line warning threshold (R1)", () => {
    for (const file of sources()) {
      const count = fs.readFileSync(path.join(REPO, file), "utf8").split("\n").length;
      assert.ok(count <= 300, `${file} has ${count} lines`);
    }
  });
});

describe("silence on the runner's Node.js, no flag and no option (R10, R25)", () => {
  let unclaimed: Fixture;
  let claimed: Fixture;
  before(() => {
    unclaimed = makeFixture({ ticket: "771" });
    claimed = makeFixture({ ticket: "771" });
    writeClaim(claimed, { holder: "alice" });
  });

  test("the guard: a safe command and a directory outside every worktree", () => {
    allowed(runGuard(payload("git status", unclaimed.wt), { cwd: unclaimed.wt }));
    allowed(runGuard(payload("git reset --hard", "/tmp/x"), { cwd: unclaimed.wt }));
  });

  test("the guard: a prohibited command, allowed by a claim (the whole claim graph loads)", () => {
    allowed(runGuard(payload("git reset --hard", claimed.wt), { cwd: claimed.wt }));
  });

  test("the guard: a prohibited command, refused: exactly the refusal and no warning", () => {
    refused(runGuard(payload("git reset --hard", unclaimed.wt), { cwd: unclaimed.wt }), "771");
  });

  test("the guard: garbage and closed standard input", () => {
    allowed(runGuard("not json", { cwd: unclaimed.wt }));
    allowed(runGuard(null, { cwd: unclaimed.wt }));
  });

  test("the claim tool: --help, status, take, release print no Node.js warning", () => {
    const fx = makeFixture();
    for (const args of [
      ["--help"],
      ["status"],
      ["take", "--agent", "a"],
      ["release", "--agent", "a"],
    ]) {
      const res = runClaim(args, { cwd: fx.wt });
      assert.doesNotMatch(
        res.stderr,
        /Warning|MODULE_TYPELESS|ExperimentalWarning|node --trace/,
        args.join(" "),
      );
      assert.equal(res.stderr, "", args.join(" "));
    }
  });

  test("the claim tool: a refusal's stderr is its own diagnostic only", () => {
    const fx = makeFixture();
    const res = runClaim(["take"], { cwd: fx.wt });
    assert.equal(res.status, 1);
    assert.match(res.stderr, /^Error: --agent <name> is required for 'take'/);
    assert.doesNotMatch(res.stderr, /Warning/);
  });

  test("the guard refusal text is the one this suite expects (a guard against a vacuous silence check)", () => {
    assert.match(refusal("771"), /^mempalace-git-guard: /);
  });
});

describe("canary: without the listener removal the lazily loaded graph warns", () => {
  test("the silence is the entry form's doing", () => {
    const tree = makeGuardTree();
    try {
      const source = fs.readFileSync(tree.entry, "utf8");
      const bare = source.replace('process.removeAllListeners("warning");', "void 0;");
      assert.notEqual(bare, source);
      fs.writeFileSync(tree.entry, bare);
      const fx = makeFixture({ ticket: "771" });
      const res = runNode(tree.entry, [], {
        cwd: fx.wt,
        input: payload("git reset --hard", fx.wt),
        env: cleanEnv(),
      });
      assert.equal(res.status, 1, "the refusal still happens");
      assert.notEqual(
        res.stderr,
        refusal("771"),
        "the channel is dead: nothing warns without the removal",
      );
    } finally {
      tree.cleanup();
    }
  });
});
