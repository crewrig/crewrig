// model-resolve-merge-root.test.ts — the merge root, its digest, reuse, the `.merges` counter,
// the ownership guard and the cleanup (scripts/lib/model-resolve/merge-root.ts,
// merge-mapping.ts; spec 0250 R20; spec 0199 R26-R28, D11). Bash cases covered: O7, O10 and
// M10 (a derived root is removed by `mappingMergeCleanup`, a `MAPPING_MERGE_DIR` root is left),
// O11 and M11 (the counter and the existence cache).

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import { mappingInForce, mappingMergeCleanup } from "../lib/model-resolve.ts";
import {
  cleanupTmp,
  makeRun,
  mergeOf,
  mkTmp,
  offering,
  orgRoot,
  realRoot,
  resolveProbe,
  rootWith,
  TARGETS,
  writeProfile,
} from "./fixtures/build-components/model-resolve-kit.ts";

after(cleanupTmp);
const EXTRA = `offerings:\n${offering("extra", 20, "extra-native", "max")}`;
const org = (target = "claude", body = EXTRA): string =>
  orgRoot(target, `target: ${target}\n${body}`);
const POSIX =
  process.platform === "win32" ? "skipped: ownership is not modelled on Windows" : undefined;
const sha = (...parts: Array<string | Buffer>): string => {
  const hash = createHash("sha256");
  parts.forEach((part, i) =>
    hash.update(i === 0 ? part : Buffer.concat([Buffer.from([0]), Buffer.from(part)])),
  );
  return hash.digest("hex");
};
const bytes = (root: string, name: string): Buffer =>
  fs.readFileSync(path.join(root, "model-mappings", name));

describe("the merge root", () => {
  test("MAPPING_MERGE_DIR is the root, with exactly one trailing slash removed", () => {
    const dir = mkTmp("rootdir");
    const root = org();
    assert.equal(path.dirname(path.dirname(mergeOf(root, "claude", `${dir}/`).handle)), dir);
    // POSIX byte parity: one slash goes, the second stays (win32 normalises the path)
    const twice = mergeOf(root, "claude", `${dir}//`).handle;
    assert.equal(process.platform === "win32" || twice.startsWith(`${dir}//`), true);
  });

  test("without it the root is <platform tmp>/crewrig-mapping-<pid>, TMPDIR winning, an empty value ignored", () => {
    const root = org();
    const base = mkTmp("base");
    const viaTmpdir = makeRun(root, { TMPDIR: `${base}/` }, { pid: 77 });
    assert.equal(
      path.dirname(path.dirname(mappingInForce(viaTmpdir.ctx, "claude"))),
      path.join(base, "crewrig-mapping-77"),
    );
    const fallback = makeRun(
      root,
      { TMPDIR: "", MAPPING_MERGE_DIR: "" },
      { pid: 78, tmpdir: base },
    );
    assert.equal(
      path.dirname(path.dirname(mappingInForce(fallback.ctx, "claude"))),
      path.join(base, "crewrig-mapping-78"),
    );
  });

  test("the root is created owner-only", { skip: POSIX }, () => {
    const m = mergeOf(org(), "claude", path.join(mkTmp("parent"), "nested", "root"));
    assert.equal(fs.statSync(m.mergeDir).mode & 0o777, 0o700);
  });
});

describe("the digest and reuse", () => {
  test("the document lives at <root>/<sha256 of target NUL core NUL org>/<target>.yml", () => {
    const root = org();
    const m = mergeOf(root);
    const want = sha("claude", bytes(root, "claude.yml"), bytes(root, "claude.org.yml"));
    assert.equal(m.handle, path.join(m.mergeDir, want, "claude.yml"));
  });

  test("with no core file the core bytes are empty", () => {
    const root = rootWith({ "t.org.yml": `target: t\n${EXTRA}\n` });
    const m = mergeOf(root, "t");
    assert.equal(
      m.handle,
      path.join(m.mergeDir, sha("t", Buffer.alloc(0), bytes(root, "t.org.yml")), "t.yml"),
    );
  });

  test("the path moves with the target, the core bytes and the org bytes, and not with the root", () => {
    const a = mergeOf(org());
    const b = mergeOf(org());
    assert.equal(path.relative(a.mergeDir, a.handle), path.relative(b.mergeDir, b.handle));
    const changed = mergeOf(org("claude", `${EXTRA}\n# one byte more`));
    assert.notEqual(
      path.relative(a.mergeDir, a.handle),
      path.relative(changed.mergeDir, changed.handle),
    );
  });

  test("O7 two merges under distinct roots are byte-identical files at distinct paths", () => {
    const root = org(
      "claude",
      `offerings:\n${offering("o7-zzz", 5, "z", "high")}\n${offering("o7-aaa", 5, "a", "high")}`,
    );
    const [a, b] = [mergeOf(root), mergeOf(root)];
    assert.notEqual(a.handle, b.handle);
    assert.deepEqual(fs.readFileSync(a.handle), fs.readFileSync(b.handle));
  });

  test("M11 an existing document is reused without a merge: contents kept, no line, no note, one count", () => {
    const root = org();
    const first = mergeOf(root);
    fs.writeFileSync(first.handle, "sentinel: kept\n");
    const again = mergeOf(root, "claude", first.mergeDir);
    assert.equal(again.handle, first.handle);
    assert.deepEqual([fs.readFileSync(again.handle, "utf8"), again.err], ["sentinel: kept\n", []]);
    assert.equal(fs.readFileSync(path.join(first.mergeDir, ".merges"), "utf8"), "claude\n");
  });

  test("the merge happens once per root across resolutions (the cache is the file's existence)", () => {
    const root = org();
    const run = makeRun(root, { MAPPING_MERGE_DIR: mkTmp("once") });
    const src = writeProfile(mkTmp(), "intelligence: max");
    const picks = [
      resolveProbe(run, src, "claude").offeringId,
      resolveProbe(run, src, "claude").offeringId,
    ];
    assert.deepEqual(picks, ["extra", "extra"]);
    assert.equal(run.err.filter((l) => l.startsWith("mapping-merge\t")).length, 1);
  });
});

describe("the .merges counter (O11)", () => {
  test("one line per merge, naming the target: one for one target, four for four, in order", () => {
    const root = realRoot();
    for (const target of TARGETS)
      fs.writeFileSync(
        path.join(root, "model-mappings", `${target}.org.yml`),
        `target: ${target}\n${EXTRA}\n`,
      );
    const one = mergeOf(root, "claude");
    assert.equal(fs.readFileSync(path.join(one.mergeDir, ".merges"), "utf8"), "claude\n");
    const dir = mkTmp("all");
    for (const target of TARGETS) mergeOf(root, target, dir);
    assert.equal(
      fs.readFileSync(path.join(dir, ".merges"), "utf8"),
      "claude\ngemini\nantigravity\ncopilot\n",
    );
  });

  test("a silent channel never creates the counter", () => {
    const m = mergeOf(realRoot());
    assert.equal(fs.existsSync(path.join(m.mergeDir, ".merges")), false);
  });
});

describe("the ownership guard", () => {
  const foreign = (root: string, dir: string) =>
    makeRun(root, { MAPPING_MERGE_DIR: dir }, { uid: (process.geteuid?.() ?? 0) + 1 });

  test(
    "a root owned by another user is refused: the core mapping and one merge-unavailable note",
    { skip: POSIX },
    () => {
      const root = org();
      const dir = mkTmp("foreign");
      const run = foreign(root, dir);
      assert.equal(
        mappingInForce(run.ctx, "claude"),
        path.join(root, "model-mappings", "claude.yml"),
      );
      assert.deepEqual(
        [run.err, fs.readdirSync(dir)],
        [[`mapping-merge-note\tclaude\tmerge-unavailable\troot=${dir}`], []],
      );
    },
  );

  test(
    "with no core mapping a refused root yields nothing, still with the note",
    { skip: POSIX },
    () => {
      const root = rootWith({ "t.org.yml": `target: t\n${EXTRA}\n` });
      const run = foreign(root, mkTmp("foreign"));
      assert.equal(mappingInForce(run.ctx, "t"), "");
      assert.equal(run.err.length, 1);
    },
  );

  test("ownership is not modelled on win32: an existing root is used whoever owns it", () => {
    const root = org();
    const run = makeRun(
      root,
      { MAPPING_MERGE_DIR: mkTmp("win") },
      { platform: "win32", uid: undefined },
    );
    assert.equal(fs.existsSync(mappingInForce(run.ctx, "claude")), true);
    assert.deepEqual(
      run.err.filter((l) => l.includes("merge-unavailable")),
      [],
    );
  });

  test("a root that cannot be created degrades the same way, never throwing", () => {
    const blocker = path.join(mkTmp("blocker"), "file");
    fs.writeFileSync(blocker, "x");
    const root = org();
    const run = makeRun(root, { MAPPING_MERGE_DIR: path.join(blocker, "sub") });
    assert.equal(
      mappingInForce(run.ctx, "claude"),
      path.join(root, "model-mappings", "claude.yml"),
    );
    assert.equal(run.err.length, 1);
    assert.match(run.err[0] ?? "", /^mapping-merge-note\tclaude\tmerge-unavailable\troot=/);
  });

  test("a root that is a plain file degrades the same way", () => {
    const file = path.join(mkTmp("plain"), "root");
    fs.writeFileSync(file, "x");
    const m = mergeOf(org(), "claude", file);
    assert.equal(m.handle.endsWith("claude.yml") && !m.handle.startsWith(file), true);
    assert.match(m.err.join(""), /merge-unavailable/);
  });
});

describe("an unreadable mapping reads as an empty document", () => {
  test("an unparseable core under a valid org: the merge still counts, the document is empty", () => {
    const root = rootWith({ "t.yml": "{{{ ::\n - [", "t.org.yml": `target: t\n${EXTRA}\n` });
    const m = mergeOf(root, "t");
    assert.deepEqual(
      [fs.readFileSync(m.handle, "utf8"), m.err],
      ["", ["mapping-merge\tt\tofferings/extra\tadded"]],
    );
    const r = resolveProbe(
      makeRun(root, { MAPPING_MERGE_DIR: m.mergeDir }),
      writeProfile(mkTmp(), "intelligence: high"),
      "t",
    );
    assert.deepEqual([r.offeringId, r.diagLines.length], ["", 1]);
  });
});

describe("mappingMergeCleanup (O10, M10)", () => {
  test("M10 a derived root is removed with every merged document in it; a sibling pid's root is not", () => {
    const base = mkTmp("tmp");
    const run = makeRun(org(), {}, { pid: 5001, tmpdir: base });
    const sibling = path.join(base, "crewrig-mapping-5002");
    fs.mkdirSync(sibling);
    const handle = mappingInForce(run.ctx, "claude");
    assert.equal(fs.existsSync(handle), true);
    mappingMergeCleanup(run.ctx);
    assert.deepEqual(
      [fs.existsSync(path.join(base, "crewrig-mapping-5001")), fs.existsSync(sibling)],
      [false, true],
    );
  });

  test("M10 a MAPPING_MERGE_DIR root is left in place, document and counter included", () => {
    const m = mergeOf(org());
    mappingMergeCleanup(m.run.ctx);
    assert.deepEqual(
      [fs.existsSync(m.handle), fs.existsSync(path.join(m.mergeDir, ".merges"))],
      [true, true],
    );
  });

  test("an empty MAPPING_MERGE_DIR counts as unset, so the derived root is removed", () => {
    const base = mkTmp("tmp");
    const run = makeRun(org(), { MAPPING_MERGE_DIR: "" }, { pid: 5003, tmpdir: base });
    mappingInForce(run.ctx, "claude");
    mappingMergeCleanup(run.ctx);
    assert.equal(fs.existsSync(path.join(base, "crewrig-mapping-5003")), false);
  });

  test("cleaning a root that never existed, or twice, does not throw", () => {
    const run = makeRun(org(), {}, { pid: 5004, tmpdir: mkTmp("tmp") });
    mappingMergeCleanup(run.ctx);
    mappingMergeCleanup(run.ctx);
  });

  test("O10 the live handle lies outside the repository root", () => {
    const root = org();
    const m = mergeOf(root);
    assert.equal(m.handle.startsWith(`${root}${path.sep}`), false);
  });
});
