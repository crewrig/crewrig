// setup-bash-triggers.test.ts — the CI capabilities that run a Bash suite retargeted onto the
// TypeScript setup trigger on everything that suite now depends on (spec 0256, seat review/1335
// finding i1-F27). A retargeted Bash wrapper (`scripts/tests/test-*.sh`) names a
// `scripts/tests/setup-retarget-*.test.ts`; that test, its import closure, the four
// `scripts/setup-*-interactive.ts` entries it spawns, the dynamically loaded golden case modules
// and the fixtures it reads must each match a trigger glob (and a cache key, when the capability has
// one) of EVERY capability whose command runs the suite, and the matching GitHub filter. Layer 1:
// node:fs only, no yaml dependency, runs on every OS.
// API: capabilities(), githubGlobs(id), suitesOf(text), required(suite) -> { suite, tsTest, files }.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { REPO } from "./lib/build-fixture-tree.ts";
import { importClosure } from "./lib/setup-source-scan.ts";

const read = (rel: string): string => fs.readFileSync(path.join(REPO, rel), "utf8");

/** Repo-relative POSIX paths of every file under `dir` (empty when it does not exist). */
const walk = (dir: string): string[] =>
  !fs.existsSync(path.join(REPO, dir))
    ? []
    : fs.readdirSync(path.join(REPO, dir), { withFileTypes: true }).flatMap((e) => {
        const rel = `${dir}/${e.name}`;
        return e.isDirectory() ? walk(rel) : [rel];
      });

/** `**` crosses directories, `*` does not; every other character is literal. */
export function globToRegExp(glob: string): RegExp {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i] ?? "";
    if (c === "*" && glob[i + 1] === "*") {
      re += ".*";
      i += 1;
      if (glob[i + 1] === "/") i += 1;
    } else if (c === "*") re += "[^/]*";
    else re += c.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

/** The files no glob of `globs` matches. */
export const uncovered = (files: Iterable<string>, globs: readonly string[]): string[] => {
  const res = globs.map(globToRegExp);
  return [...files].filter((f) => !res.some((r) => r.test(f))).sort();
};

/** A failure message that stays readable: fixtures collapse to their directory, at most 12 entries. */
const brief = (files: string[]): string[] =>
  [
    ...new Set(
      files.map((f) =>
        f.startsWith("scripts/tests/fixtures/") ? `${f.split("/").slice(0, 4).join("/")}/**` : f,
      ),
    ),
  ].slice(0, 12);

interface Capability {
  readonly id: string;
  /** One list per trigger `paths:` block (pull-request, push). */
  readonly triggers: string[][];
  readonly cache: string[];
  readonly commands: string[];
}

/** Every capability of `ci/ci-capabilities.yml`, from a plain text scan (indent-keyed). */
export function capabilities(): Capability[] {
  const out: Capability[] = [];
  let top = "";
  for (const l of read("ci/ci-capabilities.yml").split("\n")) {
    const id = /^ {2}- id: (\S+)\s*$/.exec(l)?.[1];
    if (id !== undefined) {
      out.push({ id, triggers: [], cache: [], commands: [] });
      top = "";
      continue;
    }
    const cap = out.at(-1);
    if (cap === undefined) continue;
    top = /^ {4}([\w-]+):/.exec(l)?.[1] ?? top;
    if (top === "trigger" && /^ {8}paths:\s*$/.test(l)) cap.triggers.push([]);
    const item = /^ {10}- "([^"]+)"\s*$/.exec(l)?.[1];
    if (top === "trigger" && item !== undefined) cap.triggers.at(-1)?.push(item);
    const key = /^ {8}- "([^"]+)"\s*$/.exec(l)?.[1];
    if (top === "cache" && key !== undefined) cap.cache.push(key);
    const cmd = /^ {6}- (\S.*)$/.exec(l)?.[1];
    if (top === "command" && cmd !== undefined) cap.commands.push(cmd);
  }
  return out;
}

/** The Bash suites a capability's command runs (`scripts/tests/<name>.sh`, comment lines excluded). */
export const suitesOf = (cap: Capability): string[] => [
  ...new Set(
    cap.commands.flatMap((c) =>
      [...c.matchAll(/\bscripts\/tests\/(test-[\w.-]+\.sh)/g)].map((m) => `scripts/tests/${m[1]}`),
    ),
  ),
];

/** The trigger globs of the GitHub side: a dedicated workflow's `paths:` per event, or the build.yml job filter. */
export function githubGlobs(id: string): string[][] {
  const wf = `.github/workflows/${id}.yml`;
  const lines = fs.existsSync(path.join(REPO, wf))
    ? read(wf).split("\n")
    : read(".github/workflows/build.yml").split("\n");
  const dedicated = fs.existsSync(path.join(REPO, wf));
  const lists: string[][] = [];
  if (dedicated) {
    for (const l of lines) {
      if (/^ {4}paths:\s*$/.test(l)) lists.push([]);
      const m = /^ {6}- "([^"]+)"\s*$/.exec(l);
      if (m !== null) lists.at(-1)?.push(m[1] ?? "");
    }
    return lists;
  }
  const job = lines.findIndex((l) => l === `  ${id}:`);
  if (job < 0) return [];
  let inFilter = false;
  const globs: string[] = [];
  for (const l of lines.slice(job + 1)) {
    if (/^ {2}\S/.test(l)) break;
    if (l === `            ${id}:`) inFilter = true;
    else if (inFilter) {
      const m = /^ {14}- '([^']+)'\s*$/.exec(l);
      if (m === null) break;
      globs.push(m[1] ?? "");
    }
  }
  return [globs];
}

const ENTRIES = fs
  .readdirSync(path.join(REPO, "scripts"))
  .filter((f) => /^setup-[\w-]+-interactive\.ts$/.test(f))
  .map((f) => `scripts/${f}`)
  .sort();

/** The retargeted TypeScript tests a suite names (a mention, in a comment or a command, counts). */
const namedTests = (suite: string): string[] => [
  ...new Set(
    [...read(suite).matchAll(/scripts\/tests\/(setup-retarget-[\w-]+\.test\.ts)/g)].map(
      (m) => `scripts/tests/${m[1]}`,
    ),
  ),
];

/** What a retargeted suite depends on: the tests it names, their closure, the entries, the fixtures. */
export function required(suite: string): { tsTests: string[]; files: Set<string> } | undefined {
  const tsTests = namedTests(suite).filter((t) => fs.existsSync(path.join(REPO, t)));
  if (tsTests.length === 0) return undefined;
  const files = importClosure([...tsTests, ...ENTRIES]).files;
  files.add("scripts/lib/node-floor-guard.js");
  // `setup-golden-all.ts` loads its case modules by a variable `import()`, which a static scan cannot follow.
  if (files.has("scripts/tests/lib/setup-golden-all.ts"))
    for (const f of walk("scripts/tests/lib").filter((p) =>
      /\/setup-golden-cases-[\w-]+\.ts$/.test(p),
    ))
      files.add(f);
  if (files.has("scripts/tests/lib/setup-golden-run.ts"))
    for (const f of walk("scripts/tests/fixtures/setup-golden")) files.add(f);
  // The declaration printer is what the setup-declarations goldens pin.
  if (files.has("scripts/tests/lib/print-setup-declarations.ts"))
    for (const f of walk("scripts/tests/fixtures/setup-declarations")) files.add(f);
  return { tsTests, files };
}

const retargeted = (): { cap: Capability; suite: string; files: Set<string> }[] =>
  capabilities().flatMap((cap) =>
    suitesOf(cap).flatMap((suite) => {
      const need = required(suite);
      return need === undefined ? [] : [{ cap, suite, files: need.files }];
    }),
  );

test("the retargeted suites, their capabilities and the dependency closure are non-empty (vacuity guard)", () => {
  const rows = retargeted();
  const ids = new Set(rows.map((r) => r.cap.id));
  for (const id of ["setup", "mempalace", "usage-capture", "frontmatter"])
    assert.ok(
      ids.has(id),
      `capability ${id} no longer runs a retargeted suite (detector regression?)`,
    );
  assert.ok(ENTRIES.length >= 4, `expected the four setup entries, found ${ENTRIES.join(", ")}`);
  for (const { cap, suite, files } of rows) {
    assert.ok(files.size > 50, `${suite}: a suspiciously small dependency set (${files.size})`);
    assert.ok(
      cap.triggers.length >= 2 && cap.triggers.every((t) => t.length > 0),
      `${cap.id}: an empty or missing trigger block`,
    );
  }
  const all = new Set(rows.flatMap((r) => [...r.files]));
  for (const expected of [
    "scripts/setup-claude-interactive.ts",
    "scripts/lib/setup/steps.ts",
    "scripts/lib/node-floor-guard.js",
    "scripts/tests/lib/setup-sandbox.ts",
    "scripts/tests/lib/setup-golden-all.ts",
    "scripts/tests/setup-retarget-behaviour-a.test.ts",
  ])
    assert.ok(all.has(expected), `${expected} is not in any dependency set`);
  assert.ok(
    [...all].some((f) => f.startsWith("scripts/tests/fixtures/setup-golden/")),
    "no golden fixture",
  );
  assert.ok(
    [...all].some((f) => f.startsWith("scripts/tests/fixtures/setup-declarations/")),
    "no declaration golden",
  );
});

test("every capability that runs a retargeted suite triggers on its dependencies", () => {
  for (const { cap, suite, files } of retargeted())
    for (const globs of cap.triggers)
      assert.deepEqual(
        brief(uncovered(files, globs)),
        [],
        `${cap.id} (${suite}) misses a dependency in a trigger list`,
      );
});

test("the cache key of such a capability covers the same dependencies", () => {
  for (const { cap, suite, files } of retargeted())
    if (cap.cache.length > 0)
      assert.deepEqual(
        brief(uncovered(files, cap.cache)),
        [],
        `${cap.id} (${suite}) misses a dependency in its cache key`,
      );
});

test("the GitHub filter of such a capability covers the same dependencies", () => {
  for (const { cap, suite, files } of retargeted()) {
    const lists = githubGlobs(cap.id);
    assert.ok(
      lists.length > 0 && lists.every((g) => g.length > 0),
      `${cap.id}: no readable GitHub filter`,
    );
    for (const globs of lists)
      assert.deepEqual(
        brief(uncovered(files, globs)),
        [],
        `GitHub ${cap.id} (${suite}) misses a dependency`,
      );
  }
});

test("self-test: suites are parsed, an uncovered dependency is caught, covered ones are not", () => {
  const cap: Capability = {
    id: "x",
    triggers: [],
    cache: [],
    commands: [
      "bash scripts/ci-cache-guard.sh --stray-scan -- bash scripts/tests/test-setup-mcp-merge.sh",
      "node --test scripts/tests/some.test.ts",
    ],
  };
  assert.deepEqual(suitesOf(cap), ["scripts/tests/test-setup-mcp-merge.sh"]);
  const globs = [
    "scripts/lib/**",
    "scripts/setup-*-interactive.ts",
    "scripts/tests/lib/setup-*.ts",
  ];
  assert.deepEqual(
    uncovered(
      [
        "scripts/lib/setup/a.ts",
        "scripts/setup-gemini-interactive.ts",
        "scripts/tests/lib/setup-sandbox.ts",
        "scripts/tests/lib/hermetic-env.ts",
        "scripts/tests/setup-retarget-others.test.ts",
      ],
      globs,
    ),
    ["scripts/tests/lib/hermetic-env.ts", "scripts/tests/setup-retarget-others.test.ts"],
  );
  assert.deepEqual(uncovered(["scripts/setup-x.sh"], ["scripts/setup-*-interactive.ts"]), [
    "scripts/setup-x.sh",
  ]);
});
