// check-extension-hook-tokens.test.ts — black-box edge cases of scripts/check-extension-hook-tokens.ts
// that the Bash suite does not cover: a clean fixture, a defect injected into the sandboxed
// hooks-resolve.ts, and an extension without a name.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

function sandbox(manifest: Record<string, unknown>): string {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "hook-tokens-")));
  dirs.push(root);
  fs.cpSync(path.join(REPO, "scripts"), path.join(root, "scripts"), { recursive: true });
  fs.mkdirSync(path.join(root, ".git"));
  fs.mkdirSync(path.join(root, "node_modules"));
  fs.copyFileSync(path.join(REPO, "package.json"), path.join(root, "package.json"));
  for (const pkg of ["js-yaml", "argparse"]) {
    fs.cpSync(path.join(REPO, "node_modules", pkg), path.join(root, "node_modules", pkg), {
      recursive: true,
      dereference: true,
    });
  }
  const ext = path.join(root, "extensions", "core", "tokenfix");
  fs.mkdirSync(ext, { recursive: true });
  fs.writeFileSync(path.join(ext, "extension.json"), JSON.stringify(manifest));
  fs.writeFileSync(
    path.join(ext, "package.json"),
    JSON.stringify({ name: "tokenfix", version: "0.0.1" }),
  );
  return root;
}

const withName = {
  name: "tokenfix",
  version: "0.0.1",
  description: "fixture",
  provenance: { canonical: "https://example.test/upstream" },
  hooks: [{ id: "probe", event: "PreToolUse", command: "bash ${extensionRoot}/hooks/handler.sh" }],
};

function run(root: string) {
  const r = spawnSync(process.execPath, ["scripts/check-extension-hook-tokens.ts"], {
    cwd: root,
    encoding: "utf8",
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

describe("check-extension-hook-tokens", () => {
  it("passes a correctly substituted fixture", () => {
    const r = run(sandbox(withName));
    assert.equal(r.code, 0, r.out + r.err);
    assert.match(r.out, /^OK: no emitted hook file carries/m);
  });

  it("names hooks/hooks.json when a defect leaves the token", () => {
    const root = sandbox(withName);
    const file = path.join(root, "scripts/lib/extension/hooks-resolve.ts");
    const text = fs.readFileSync(file, "utf8");
    // Make the resolver a no-op by rewriting the neutral token it replaces.
    fs.writeFileSync(file, text.split("${extensionRoot}").join("${extensionRootX}"));
    const r = run(root);
    assert.equal(r.code, 1, r.out + r.err);
    assert.match(r.out, /FAIL .*hooks\/hooks\.json — surviving neutral token occurrence 1\/1/);
    assert.match(r.out, /FAILED: \d+ emitted hook file\(s\)/);
  });

  it("skips an extension without a name", () => {
    const { name: _name, ...rest } = withName;
    const r = run(sandbox(rest));
    assert.equal(r.code, 0, r.out + r.err);
    assert.match(r.out, /^OK:/m);
  });
});
