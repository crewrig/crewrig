// usage-archive-scopes.test.ts — the hook scripts of the archive and the layout that lets their libraries load
// (spec 0243 delta-05 R40, R41(c)). Two parts:
//   1. the closure test of R41(c): walk the specifier closure of the four hook scripts in the archive layout and
//      fail unless every reached CommonJS `.js` file resolves to a nearest package.json declaring "commonjs" and
//      every reached file with import/export syntax resolves to the archive root ("module"). Removing a scope file,
//      or putting an ECMAScript file back in a scoped directory, must fail it; the cases below do each in memory;
//   2. the R40 scenarios: the real entries, the real hook-run.ts, run from the extracted archive under an ancestor
//      package.json of each of the four types, and from the checkout. Exit status and silence do not prove the
//      work (the entries catch a failed import()), so the observers check journal records, the shim's prior line,
//      the daemon diagnostics and the worktree guard's claim decision.
// The suite runs on the runner's Node.js: CI runs it on Node.js 24.0.0 and on the current Node.js 24 release
// (EXPECT_NODE_VERSION, when set, makes the run fail if the runtime is not the one the job names).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, test } from "node:test";
import {
  ANCESTORS,
  observeGuard,
  observeShim,
  observeTranscript,
  observeUsageCapture,
  makeCell,
  type Cell,
} from "./lib/archive-hooks.ts";
import { checkScopes, walkClosure, type Files } from "./lib/closure-walk.ts";
import { REPO, trackRigs } from "./lib/launcher-rig.ts";
import { archiveOfVersion } from "./lib/org-rig.ts";
import { readTarGz } from "./lib/tar-reader.ts";

const rigs = trackRigs();
const HOOKS = [
  "hooks/usage-capture.ts",
  "hooks/antigravity-statusline-shim.ts",
  "hooks/mempalace-transcript.ts",
  "hooks/worktree-git-guard.ts",
];

const archive = archiveOfVersion("1.0.0-test.1");

function archiveFiles(): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  for (const record of readTarGz(archive.file)) {
    if (record.type === "file") files.set(record.path, record.data);
  }
  return files;
}

const tracked = (() => {
  const listed = spawnSync("git", ["ls-files", "-z"], { cwd: REPO, encoding: "utf8" });
  const names = new Set(listed.stdout.split("\0"));
  return (rel: string): boolean => names.has(rel);
})();

/** The scope findings of the closure of the four hooks over `files`. */
function findingsOf(files: Files): string[] {
  const { reached } = walkClosure(files, HOOKS, tracked);
  return checkScopes(files, reached).map((finding) => `${finding.file}: ${finding.problem}`);
}

const edited = (edit: (files: Map<string, Buffer>) => void): Map<string, Buffer> => {
  const files = archiveFiles();
  edit(files);
  return files;
};

describe("the runtime of the run", () => {
  test(`runs on Node.js ${process.version}, and on the version the job names when it names one`, () => {
    const expected = process.env["EXPECT_NODE_VERSION"];

    if (expected !== undefined && expected !== "") assert.equal(process.versions.node, expected);

    assert.match(process.versions.node, /^24\./);
  });
});

describe("R41(c): the scopes of the closure of the four hook scripts, in the archive layout", () => {
  test("the walk reaches the libraries the hooks load, so the check is not vacuous", () => {
    const { reached, missing } = walkClosure(archiveFiles(), HOOKS, tracked);

    for (const file of [
      "scripts/lib/usage-capture/cursor.js",
      "scripts/lib/usage-capture/index.js",
      "scripts/lib/usage-capture/adapters/claude-code.js",
      "scripts/lib/usage-hook/hook-run.ts",
      "scripts/lib/usage-store/mcp.js",
      "scripts/lib/worktree-claim/claim-state.ts",
      "scripts/lib/tmp-file.ts",
    ]) {
      assert.ok(reached.includes(file), `${file} is in the closure`);
    }
    assert.ok(
      reached.some(
        (file) => file.startsWith("scripts/lib/usage-store/validator/") && file.endsWith(".js"),
      ),
      "the vendored validator is in the closure",
    );
    assert.deepEqual(missing, [], "every reached file is in the archive");
  });

  test("every reached CommonJS .js file is in a commonjs scope and every ECMAScript file is in the root scope", () => {
    assert.deepEqual(findingsOf(archiveFiles()), []);
  });

  test("the scope files and the moved files are in the archive (R41(d))", () => {
    const files = archiveFiles();

    for (const dir of ["usage-capture", "usage-store"]) {
      const text = files.get(`scripts/lib/${dir}/package.json`)?.toString() ?? "null";
      assert.deepEqual(JSON.parse(text), { type: "commonjs" }, `${dir}: the single member type`);
    }
    assert.ok(files.has("scripts/lib/usage-hook/hook-run.ts"));
    assert.ok(files.has("scripts/lib/usage-inventory/inventory.ts"));
    assert.ok(!files.has("scripts/lib/usage-capture/hook-run.ts"));
    assert.ok(!files.has("scripts/lib/usage-store/inventory.ts"));
    assert.ok(
      ![...files.keys()].some((file) =>
        /^scripts\/lib\/usage-(hook|inventory)\/package\.json$/.test(file),
      ),
    );
  });

  for (const scope of [
    "scripts/lib/usage-capture/package.json",
    "scripts/lib/usage-store/package.json",
  ]) {
    test(`removing ${scope} fails the closure test`, () => {
      const findings = findingsOf(edited((files) => files.delete(scope)));

      assert.ok(findings.length > 0, "the closure test cannot fail");
      assert.ok(
        findings.every((finding) => finding.includes("not commonjs")),
        findings.join("\n"),
      );
    });
  }

  test("putting an ECMAScript file back in a scoped directory fails the closure test", () => {
    const findings = findingsOf(
      edited((files) => {
        const source = files.get("scripts/lib/usage-hook/hook-run.ts") as Buffer;
        files.set("scripts/lib/usage-capture/hook-run.ts", source);
        const entry = (files.get("hooks/usage-capture.ts") as Buffer)
          .toString("utf8")
          .replace("usage-hook/hook-run.ts", "usage-capture/hook-run.ts");
        files.set("hooks/usage-capture.ts", Buffer.from(entry));
      }),
    );

    assert.ok(
      findings.some(
        (finding) =>
          finding.startsWith("scripts/lib/usage-capture/hook-run.ts") &&
          finding.includes("not the archive root"),
      ),
      findings.join("\n"),
    );
  });

  test("a root package.json that is not a module root fails it, and so does its absence", () => {
    const commonjs = findingsOf(
      edited((files) => files.set("package.json", Buffer.from('{"type":"commonjs"}\n'))),
    );
    const absent = findingsOf(edited((files) => files.delete("package.json")));

    assert.ok(
      commonjs.some((finding) => finding.includes("not the archive root")),
      commonjs.join("\n"),
    );
    assert.ok(
      absent.some((finding) => finding.includes("not the archive root")),
      absent.join("\n"),
    );
  });
});

describe("R40: the entries do their work from the archive under every hostile ancestor", () => {
  for (const ancestor of ANCESTORS) {
    describe(`an ancestor of the version directory that is ${ancestor}`, () => {
      const observers = [
        [
          "usage-capture.ts records the transcript once, and the second run records nothing",
          observeUsageCapture,
        ],
        ["the shim prints the prior command's line and captures the snapshot", observeShim],
        ["mempalace-transcript.ts reaches its daemon call (both diagnostics)", observeTranscript],
        ["worktree-git-guard.ts refuses without a claim and allows with one", observeGuard],
      ] as const;
      for (const [name, observe] of observers) {
        test(name, () => {
          const observation = observe(makeCell(rigs.make(), archive, ancestor));

          assert.ok(observation.good, observation.why);
          assert.ok(!observation.noisy, "a module-type message reached a stream");
        });
      }
    });
  }
});

describe("R40: the same entries on the checkout keep their behaviour", () => {
  const checkout = (): Cell => ({
    rig: rigs.make(),
    root: REPO,
    ancestor: "typeless",
    home: path.join(rigs.make().newDir("checkout-home")),
  });
  for (const [name, observe] of [
    ["usage-capture.ts", observeUsageCapture],
    ["the shim", observeShim],
    ["mempalace-transcript.ts", observeTranscript],
    ["worktree-git-guard.ts", observeGuard],
  ] as const) {
    test(`${name} does its work, with no module-type warning`, () => {
      const observation = observe(checkout());

      assert.ok(observation.good, observation.why);
      assert.ok(!observation.noisy);
    });
  }
});
