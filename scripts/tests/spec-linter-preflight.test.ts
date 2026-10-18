// Replaces scripts/tests/test-spec-linter.sh (Cases 49-51: dependency preflights, spec 0225).
// Each case owns a disjoint mkdtemp root with REAL copies (never symlinks) of what it needs and
// no node_modules above it: require() walks up every ancestor, so isolation is the point.
// Cleanup removes only the roots created here.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { lintEnv, renderSpec } from "./lib/spec-linter-fixtures.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const T = { timeout: 60_000 };
const roots: string[] = [];
after(() => {
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
});

function mkRoot(prefix: string): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  roots.push(root);
  return root;
}

function copyPackage(root: string, name: string): void {
  const dest = path.join(root, "node_modules", name);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.cpSync(path.join(REPO, "node_modules", name), dest, { recursive: true, dereference: true });
}

function ancestorHasNodeModules(dir: string): string | undefined {
  for (let d = dir; ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, "node_modules"))) return d;
    if (path.dirname(d) === d) return undefined;
  }
}

/** A root holding a copy of the linter as `spec-linter.js` and one draft spec. */
function linterRoot(prefix: string, specName: string, spec: string): string {
  const root = mkRoot(prefix);
  fs.copyFileSync(path.join(REPO, "scripts/lib/spec-linter.js"), path.join(root, "spec-linter.js"));
  fs.writeFileSync(path.join(root, specName), spec);
  return root;
}

function runCopy(root: string, spec: string, env: Record<string, string | undefined> = {}) {
  const r = spawnSync(process.execPath, [path.join(root, "spec-linter.js"), spec], {
    cwd: root,
    env: lintEnv(env),
    encoding: "utf8",
  });
  return { status: r.status, output: r.stdout + r.stderr };
}

describe("spec-linter dependency preflights (spec 0225)", () => {
  test(
    "Case 49 — missing js-yaml/semver reports one actionable line, no stack trace (exit 1)",
    T,
    (t) => {
      const root = linterRoot(
        "spec-linter-49-",
        "0049-no-deps.md",
        renderSpec({ id: "0049", slug: "no-deps" }),
      );
      const above = ancestorHasNodeModules(root);
      if (above) return t.skip(`ancestor ${above} holds a node_modules`);
      const r = runCopy(root, "0049-no-deps.md");
      assert.equal(r.status, 1, r.output);
      assert.ok(r.output.includes("Missing dependency 'js-yaml'"), r.output);
      assert.ok(r.output.includes("Run: task lint-bootstrap"), r.output);
      assert.ok(!/^\s+at /m.test(r.output), r.output);
      assert.ok(!r.output.includes("MODULE_NOT_FOUND"), r.output);
    },
  );

  // js-yaml requires argparse, so three packages are copied. PATH keeps node/npx but an empty
  // NPM_CONFIG_PREFIX hides any global markdownlint-cli install, independent of the host.
  test("Case 50 — missing markdownlint-cli fails closed before the real pass (exit 1)", T, (t) => {
    if (process.platform === "win32") return t.skip("POSIX PATH and prefix layout");
    const root = linterRoot(
      "spec-linter-50-",
      "0050-no-markdownlint.md",
      renderSpec({ id: "0050", slug: "no-markdownlint" }),
    );
    for (const pkg of ["js-yaml", "argparse", "semver"]) copyPackage(root, pkg);
    fs.copyFileSync(path.join(REPO, ".markdownlintrc"), path.join(root, ".markdownlintrc"));
    const prefix = mkRoot("spec-linter-50-prefix-");
    fs.mkdirSync(path.join(prefix, "lib", "node_modules"), { recursive: true });
    const r = runCopy(root, "0050-no-markdownlint.md", {
      PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`,
      NPM_CONFIG_PREFIX: prefix,
    });
    assert.equal(r.status, 1, r.output);
    assert.ok(r.output.includes("markdownlint-cli is not resolvable"), r.output);
    assert.ok(r.output.includes("Run: task lint-bootstrap"), r.output);
    assert.ok(!r.output.includes("Running markdownlint-cli on"), r.output);
    assert.ok(!r.output.includes("could not determine executable to run"), r.output);
  });

  // A present but broken js-yaml must surface its own error, not a false "Missing dependency".
  test(
    "Case 51 — a broken (present) dependency surfaces its real error, not a false 'missing' report",
    T,
    () => {
      const root = linterRoot(
        "spec-linter-51-",
        "0051-broken-dep.md",
        renderSpec({ id: "0051", slug: "broken-dep" }),
      );
      const pkg = path.join(root, "node_modules", "js-yaml");
      fs.mkdirSync(pkg, { recursive: true });
      fs.writeFileSync(path.join(pkg, "package.json"), '{"name": "js-yaml", "main": "index.js"}\n');
      fs.writeFileSync(path.join(pkg, "index.js"), "const x = ;\n");
      const r = runCopy(root, "0051-broken-dep.md");
      assert.notEqual(r.status, 0, r.output);
      assert.ok(!r.output.includes("Missing dependency"), r.output);
      assert.match(r.output, /SyntaxError|Unexpected token/);
    },
  );
});
