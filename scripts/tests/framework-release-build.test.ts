// Spec 0310 R3, R4, R11, R12: the manifest check, the archive, the digest and the notes.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { main } from "../lib/framework-release/build-main.ts";
import {
  MANIFEST_FILE,
  parseManifest,
  parseManifestEntries,
  resolveManifest,
} from "../lib/framework-release/manifest.ts";
import { sha256File } from "../lib/packaging/digest.ts";
import { Fixture } from "./lib/framework-release-fixture.ts";
import { readTarGz } from "./lib/tar-reader.ts";

const REPO = path.resolve(import.meta.dirname, "..", "..");

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

/**
 * The js-yaml package beside the fixture, as `npm ci` leaves it (spec 0315 step 6): the release build
 * stages it, and the lock it is checked against names the same version.
 */
function vendorYaml(): void {
  const src = path.join(REPO, "node_modules", "js-yaml");
  const dst = path.join(fx.work, "node_modules", "js-yaml");
  fs.mkdirSync(path.join(dst, "dist"), { recursive: true });
  const pkg = fs.readFileSync(path.join(src, "package.json"), "utf8");
  fs.writeFileSync(path.join(dst, "package.json"), pkg);
  fs.copyFileSync(path.join(src, "LICENSE"), path.join(dst, "LICENSE"));
  fs.copyFileSync(path.join(src, "dist", "js-yaml.mjs"), path.join(dst, "dist", "js-yaml.mjs"));
  const version = (JSON.parse(pkg) as { version: string }).version;
  const lock = { packages: { "node_modules/js-yaml": { version } } };
  fs.writeFileSync(path.join(fx.work, "package-lock.json"), JSON.stringify(lock));
}

function seed(): void {
  fx.commit({ "rules/a.md": "a", "rules/sub/b.md": "b", "hooks/run.ts": "h", "other/c.txt": "c" });
  vendorYaml();
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

const ARCHIVE_PACKAGE = '{"name": "crewrig", "type": "module"}\n';

/** The archive package.json: one JSON object with exactly two members, `name` = `crewrig` and `type` = `module`. */
function isModuleRoot(text: string): boolean {
  const parsed: unknown = JSON.parse(text);
  return (
    typeof parsed === "object" &&
    parsed !== null &&
    JSON.stringify(Object.entries(parsed).sort()) === '[["name","crewrig"],["type","module"]]'
  );
}

function namesOf(outDir: string): string[] {
  return readTarGz(path.join(outDir, "crewrig-1.0.0-next.1.tgz")).map((r) => r.path);
}

describe("spec 0315 R11: a mapped manifest entry ships a tracked file under another archive path", () => {
  it("ships the content of the source at the archive path, and the source path itself only when it is listed", () => {
    seed();
    fx.commit({ "meta/archive-package.json": ARCHIVE_PACKAGE });
    const res = build("package.json <- meta/archive-package.json\nrules\n");
    assert.equal(res.code, 0, res.err.join("\n"));
    const records = readTarGz(path.join(res.outDir, "crewrig-1.0.0-next.1.tgz"));
    const shipped = records.find((r) => r.path === "package.json");
    assert.ok(shipped, "package.json is in the archive");
    assert.equal(shipped.data.toString("utf8"), ARCHIVE_PACKAGE);
    assert.ok(!records.some((r) => r.path === "meta/archive-package.json"));
  });

  it("refuses a source that exists but is not tracked by git, and ships nothing", () => {
    seed();
    fs.mkdirSync(path.join(fx.work, "meta"));
    fs.writeFileSync(path.join(fx.work, "meta", "archive-package.json"), ARCHIVE_PACKAGE);
    const res = build("package.json <- meta/archive-package.json\n");
    assert.equal(res.code, 1);
    assert.match(res.err.join("\n"), /must map a file that git tracks/);
    assert.equal(fs.existsSync(res.outDir), false);
  });

  it("has no dist/ exemption: a git-ignored source under dist/ is refused", () => {
    seed();
    fx.commit({ ".gitignore": "dist/\n" });
    fs.mkdirSync(path.join(fx.work, "dist"));
    fs.writeFileSync(path.join(fx.work, "dist", "pkg.json"), ARCHIVE_PACKAGE);
    const res = build("package.json <- dist/pkg.json\n");
    assert.equal(res.code, 1);
    assert.match(res.err.join("\n"), /must map a file that git tracks/);
  });

  it("refuses a source that is absent, and a source that is a directory", () => {
    seed();
    const absent = build("package.json <- meta/none.json\n");
    assert.equal(absent.code, 1);
    assert.match(absent.err.join("\n"), /absent from the build output/);
    const directory = build("package.json <- rules\n");
    assert.equal(directory.code, 1);
    assert.match(directory.err.join("\n"), /must map a file that git tracks/);
  });

  it("fails on a collision: two sources for one archive path, from a mapping and from a directory entry", () => {
    seed();
    fx.commit({ "meta/other.md": "other" });
    const res = build("rules\nrules/a.md <- meta/other.md\n");
    assert.equal(res.code, 1);
    assert.match(
      res.err.join("\n"),
      /archive path 'rules\/a\.md' is provided twice: by 'rules\/a\.md' and by 'meta\/other\.md'/,
    );
    assert.equal(fs.existsSync(res.outDir), false);
  });

  it("rejects a mapped line that is not a clean pair, and an archive path listed twice", () => {
    for (const bad of ["a <- b <- c", "../a <- b", "a <- /b", "a <- b/", "a/ <- b"]) {
      assert.throws(() => parseManifestEntries(`${bad}\n`), /not a clean relative path/, bad);
    }
    assert.throws(
      () => parseManifestEntries("package.json <- a.json\npackage.json\n"),
      /'package.json' is listed twice/,
    );
  });
});

describe("spec 0315 R11: the archive root package.json of the committed manifest", () => {
  const records = parseManifestEntries(fs.readFileSync(MANIFEST_FILE, "utf8"));

  it("is mapped from a tracked file, and its content is exactly the two members name=crewrig and type=module", () => {
    const entry = records.find((record) => record.archive === "package.json");
    assert.ok(entry, "manifest.txt maps package.json");
    assert.notEqual(
      entry.source,
      "package.json",
      "it is not a copy of the repository's own package.json",
    );

    const bytes = fs.readFileSync(path.join(REPO, entry.source), "utf8");

    assert.ok(isModuleRoot(bytes), `not a two-member module root: ${bytes}`);
    assert.deepEqual(JSON.parse(bytes), { name: "crewrig", type: "module" });
    const root = fs.readFileSync(path.join(REPO, "package.json"), "utf8");
    assert.notEqual(bytes, root);
    // The archive name above is pinned to the root name: a rename fails here (0315 delta-03).
    assert.equal((JSON.parse(root) as { name?: unknown }).name, "crewrig");
  });

  it("resolves, in this checkout, to a file whose bytes are those of the archive package.json", () => {
    const shipped = resolveManifest(
      REPO,
      records.filter(
        (record) =>
          !(record.source.startsWith("dist/") && !fs.existsSync(path.join(REPO, record.source))),
      ),
    ).find((file) => file.path === "package.json");

    assert.ok(shipped);
    assert.ok(isModuleRoot(fs.readFileSync(shipped.abs, "utf8")));
  });
});
