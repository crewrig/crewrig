// extension-hooks-layouts.test.ts — the four package layouts of spec 0258 R2. Each example hook is
// copied under a package that declares `"type": "module"`, one that declares `"type": "commonjs"`, a
// typeless one, and a directory with no `package.json`, plus the real `hello-world` package.json; the
// four (five) runs must give the same standard output, an empty standard error and exit status 0.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import { HOOKS, REPO, runEntry } from "./lib/extension-hooks-harness.ts";

const PAYLOAD = Buffer.from('  {"tool":"shell","args":["ls", "-la"]} \t\nsecond line\n');
const EXPECTED = '{"tool":"shell","args":["ls", "-la"]}\n';

const LAYOUTS: readonly [string, string | undefined][] = [
  ["type module", '{"type":"module"}'],
  ["type commonjs", '{"type":"commonjs"}'],
  ["typeless package", "{}"],
  ["no package.json", undefined],
  [
    "the real hello-world package.json",
    fs.readFileSync(path.join(REPO, "extensions/core/hello-world/package.json"), "utf8"),
  ],
];

let root = "";
before(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "hooks-layouts-"));
});
after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

for (const hook of HOOKS) {
  describe(`${hook}: package layouts`, () => {
    const outcomes: { layout: string; stdout: string; stderr: string; status: number | null }[] =
      [];

    for (const [layout, packageJson] of LAYOUTS) {
      test(`${layout}: the copy runs silently`, () => {
        const dir = fs.mkdtempSync(path.join(root, "case-"));
        if (packageJson !== undefined)
          fs.writeFileSync(path.join(dir, "package.json"), packageJson);
        const copy = path.join(dir, "hook.ts");
        fs.copyFileSync(path.join(REPO, `${hook}.ts`), copy);
        const result = runEntry(hook, { kind: "pipe", data: PAYLOAD }, copy);
        outcomes.push({
          layout,
          stdout: result.stdout.toString(),
          stderr: result.stderr.toString(),
          status: result.status,
        });
        assert.equal(result.stderr.toString(), "");
        assert.equal(result.status, 0);
        assert.equal(result.stdout.toString(), EXPECTED);
      });
    }

    test("the layouts agree on standard output, standard error and exit status", () => {
      assert.equal(outcomes.length, LAYOUTS.length);
      const first = outcomes[0];
      for (const outcome of outcomes) {
        assert.deepEqual(
          { stdout: outcome.stdout, stderr: outcome.stderr, status: outcome.status },
          { stdout: first?.stdout, stderr: first?.stderr, status: first?.status },
          outcome.layout,
        );
      }
    });
  });
}
