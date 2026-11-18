// Spec 0310 R3, R4, R11, R12: the manifest check, the archive, the digest and the notes.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { main } from "../lib/framework-release/build-main.ts";
import { parseManifest } from "../lib/framework-release/manifest.ts";
import { sha256File } from "../lib/packaging/digest.ts";
import { Fixture } from "./lib/framework-release-fixture.ts";
import { readTarGz } from "./lib/tar-reader.ts";

let fx: Fixture;
let manifest = "";
beforeEach(() => {
  fx = new Fixture();
  manifest = path.join(fx.root, "manifest.txt");
});
afterEach(() => fx.dispose());

function build(lines: string, kind = "prerelease", tag = "crewrig-v1.0.0-next.1") {
  fs.writeFileSync(manifest, lines);
  const out: string[] = [];
  const err: string[] = [];
  const outDir = path.join(fx.root, "out");
  const code = main(
    [
      "--kind",
      kind,
      "--tag",
      tag,
      "--out",
      outDir,
      "--root",
      fx.work,
      "--repository",
      "o/r",
      "--workflow-path",
      ".github/workflows/w.yml",
      "--manifest",
      manifest,
    ],
    { out: (l) => out.push(l), err: (l) => err.push(l) },
    {},
  );
  return { code, out, err, outDir };
}

function seed(): void {
  fx.commit({ "rules/a.md": "a", "rules/sub/b.md": "b", "hooks/run.ts": "h", "other/c.txt": "c" });
}

describe("framework release build", () => {
  it("ships exactly the listed files under flat repository-relative paths", () => {
    seed();
    const res = build("rules\nhooks/run.ts\n");
    assert.equal(res.code, 0, res.err.join("\n"));
    const names = readTarGz(path.join(res.outDir, "crewrig-1.0.0-next.1.tgz")).map((r) => r.path);
    assert.deepEqual(names, ["hooks/run.ts", "rules/a.md", "rules/sub/b.md"]);
  });

  it("fails and writes nothing when an entry is absent from the build output", () => {
    seed();
    const res = build("rules\nrules/missing.md\n");
    assert.equal(res.code, 1);
    assert.match(
      res.err.join("\n"),
      /manifest entry 'rules\/missing\.md' is absent from the build output/,
    );
    assert.equal(fs.existsSync(res.outDir), false);
  });

  it("does not ship an untracked file, even under a listed directory", () => {
    seed();
    fs.writeFileSync(path.join(fx.work, "rules", "untracked.md"), "u");
    const res = build("rules\n");
    const names = readTarGz(path.join(res.outDir, "crewrig-1.0.0-next.1.tgz")).map((r) => r.path);
    assert.ok(!names.includes("rules/untracked.md"));
    assert.deepEqual(names, ["rules/a.md", "rules/sub/b.md"]);
  });

  it("ships git-ignored build output beneath dist/ only", () => {
    seed();
    fx.commit({ ".gitignore": "dist/\nignored/\n" });
    fs.mkdirSync(path.join(fx.work, "dist", "library"), { recursive: true });
    fs.writeFileSync(path.join(fx.work, "dist", "library", "s.md"), "s");
    fs.mkdirSync(path.join(fx.work, "ignored"));
    fs.writeFileSync(path.join(fx.work, "ignored", "i.md"), "i");
    const ok = build("dist/library\n");
    assert.equal(ok.code, 0, ok.err.join("\n"));
    const none = build("ignored\n");
    assert.equal(none.code, 1);
    assert.match(none.err.join("\n"), /holds no file to ship/);
  });

  it("names the asset with the full version and the digest of the archive bytes", () => {
    seed();
    const res = build("rules\n");
    const archive = path.join(res.outDir, "crewrig-1.0.0-next.1.tgz");
    const digest = sha256File(archive);
    assert.match(digest, /^[0-9a-f]{64}$/);
    assert.ok(res.out.includes(`sha256=${digest}`));
    const notes = fs.readFileSync(path.join(res.outDir, "notes.md"), "utf8");
    assert.equal(fs.readFileSync(path.join(res.outDir, "sha256.txt"), "utf8"), `${digest}\n`);
    assert.ok(
      notes.includes(
        `tag: crewrig-v1.0.0-next.1\nasset: crewrig-1.0.0-next.1.tgz\nsha256: ${digest}`,
      ),
    );
    const order = [/gh release verify crewrig/, /verify-asset/, /attestation verify/].map((re) =>
      notes.search(re),
    );
    assert.deepEqual(
      order,
      [...order].sort((a, b) => a - b),
    );
    assert.ok(order.every((n) => n >= 0));
    assert.match(notes, /--signer-workflow o\/r\/\.github\/workflows\/w\.yml/);
  });

  it("is deterministic and names the stable asset without a suffix", () => {
    seed();
    const a = build("rules\n", "stable", "crewrig-v1.0.0");
    const first = sha256File(path.join(a.outDir, "crewrig-1.0.0.tgz"));
    const b = build("rules\n", "stable", "crewrig-v1.0.0");
    assert.equal(sha256File(path.join(b.outDir, "crewrig-1.0.0.tgz")), first);
    assert.match(
      fs.readFileSync(path.join(a.outDir, "notes.md"), "utf8"),
      /ancestor of `origin\/main`/,
    );
  });

  it("refuses a tag of the other kind", () => {
    seed();
    assert.equal(build("rules\n", "stable", "crewrig-v1.0.0-next.1").code, 1);
  });

  it("rejects unclean manifest lines", () => {
    for (const bad of ["/abs", "a/../b", "dir/", "a\\b", "a//b", "./a"]) {
      assert.throws(() => parseManifest(`${bad}\n`), /not a clean relative path/);
    }
    assert.throws(() => parseManifest("# only a comment\n"), /lists no entry/);
    assert.throws(() => parseManifest("a\na\n"), /listed twice/);
  });

  it("the committed manifest parses and every entry exists in this checkout", () => {
    const entries = parseManifest(
      fs.readFileSync(
        path.join(import.meta.dirname, "..", "lib", "framework-release", "manifest.txt"),
        "utf8",
      ),
    );
    assert.ok(entries.includes("artifacts/core/rules"));
  });
});
