// setup-gemini-settings-failure.test.ts — group G11 of scripts/tests/test-setup-gemini-settings-merge.sh
// (spec 0263): the backup comes first, the file ends owner-only, and the return codes 0, 1 and 2.
// Deviations pinned by the PLAN annex: 11b mocks `writeFileSync` on the `.bak.` path (the backup is not made
// with `copyFileSync`); 11d is pinned by the rc-2 sentence of the TypeScript port (`removing the stale
// <T>.tmp`), the shell's org-fold sentence retires with the shell.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, mock, test } from "node:test";

import {
  FAKE_PY,
  MODE_SKIP,
  ORACLE_MEMPALACE,
  TEMPLATE_FILES,
  caseWith,
  canon,
  expectMode600,
  expectNoTmp,
  gsWrite,
  readDoc,
} from "./lib/gemini-settings-rig.ts";
import { WINDOWS } from "./lib/worktree-fixtures.ts";

afterEach(() => mock.restoreAll());

const same = (a: string, b: string): void => assert.equal(a, b);
const errText = (c: { err: string[] }): string => c.err.join("\n");

/** A non-empty directory at `<target>.tmp`: it cannot be removed, so the fold ends with status 2. */
function plantStaleDir(target: string): void {
  fs.mkdirSync(`${target}.tmp`);
  fs.writeFileSync(path.join(`${target}.tmp`, "keep"), "x");
}

describe("G11 backup first, owner-only, return codes", () => {
  test("11a an existing 0644 file: backup holds the prior bytes, 0600, no tmp", () => {
    const original = '{"ui": {"theme": "x"}}\n';
    const c = gsWrite(caseWith(original), FAKE_PY);
    assert.equal(c.rc, 0);
    const baks = fs
      .readdirSync(path.dirname(c.target))
      .filter((n) => n.startsWith("settings.json.bak."));
    assert.equal(baks.length, 1);
    assert.equal(
      fs.readFileSync(path.join(path.dirname(c.target), baks[0] ?? ""), "utf8"),
      original,
    );
    if (!WINDOWS) expectMode600(c);
    expectNoTmp(c);
  });

  test("11b a backup that cannot be made: rc 1, target byte-identical, the ERROR names it", () => {
    const original = '{"ui": {"theme": "x"}}\n';
    const c = caseWith(original);
    const real = fs.writeFileSync;
    mock.method(fs, "writeFileSync", ((p: fs.PathOrFileDescriptor, ...rest: unknown[]) => {
      if (typeof p === "string" && p.includes(".bak.")) {
        throw Object.assign(new Error("EACCES"), { code: "EACCES" });
      }
      return (real as (...a: unknown[]) => void)(p, ...rest);
    }) as typeof fs.writeFileSync);
    gsWrite(c, FAKE_PY);
    mock.restoreAll();
    assert.equal(c.rc, 1);
    same(fs.readFileSync(c.target, "utf8"), original);
    assert.ok(
      c.err.includes(`  ERROR: the backup could not be created; ${c.target} was left unchanged.`),
      errText(c),
    );
    expectNoTmp(c);
  });

  test("11c a template that is not JSON: rc 1, target identical, the ERROR names the backup", () => {
    const original = '{"ui": {"theme": "x"}}\n';
    const c = caseWith(original);
    const bad = `${c.home}/bad-template.json`;
    fs.writeFileSync(bad, "{ not json\n");
    gsWrite(c, FAKE_PY, undefined, bad);
    assert.equal(c.rc, 1);
    same(fs.readFileSync(c.target, "utf8"), original);
    assert.ok(errText(c).includes(`${c.target} was left unchanged.`), errText(c));
    assert.ok(
      errText(c).includes(
        `The prior file is preserved in the timestamped backup: ${c.target}.bak.`,
      ),
      errText(c),
    );
    expectNoTmp(c);
  });

  test("11d rc 2: the target holds the merged settings, the ERROR names the stale tmp and the backup", () => {
    const c = caseWith('{"ui": {"theme": "x"}, "hooks": {"Notification": []}}\n');
    plantStaleDir(c.target);
    gsWrite(c, FAKE_PY, '{"org-only": {"command": "org-cmd"}}');
    assert.equal(c.rc, 2);
    const d = readDoc(c) as {
      ui: unknown;
      hooks: unknown;
      context: { fileName: unknown };
      mcpServers: Record<string, unknown>;
    };
    assert.equal(
      canon([d.ui, d.hooks, d.context.fileName, d.mcpServers["mempalace"]]),
      canon([{ theme: "x" }, { Notification: [] }, TEMPLATE_FILES, ORACLE_MEMPALACE]),
    );
    assert.equal(
      canon(d.mcpServers["org-only"]),
      canon({ command: "org-cmd" }),
      "TypeScript merges the org fold in one pass",
    );
    assert.equal(
      c.err[0],
      `  ERROR: ${c.target} holds the merged settings, but removing the stale ${c.target}.tmp did not complete.`,
    );
    assert.ok(
      (c.err[1] ?? "").includes(
        `The prior file is preserved in the timestamped backup: ${c.target}.bak.`,
      ),
    );
  });

  test("11d rc 2 leaves the file owner-only", { skip: MODE_SKIP }, () => {
    const c = caseWith('{"ui": {"theme": "x"}}\n');
    plantStaleDir(c.target);
    gsWrite(c, "");
    assert.equal(c.rc, 2);
    expectMode600(c);
  });

  test(
    "11e a stale 0644 <T>.tmp file beside an operator secret: kept, 0600, no tmp left",
    { skip: MODE_SKIP },
    () => {
      const c = caseWith(
        '{"ui": {"theme": "x"}, "mcpServers": {"github": {"command": "gh-mcp", "env": {"GITHUB_TOKEN": "OPERATOR-SECRET"}}}}\n',
      );
      fs.chmodSync(c.target, 0o600);
      fs.writeFileSync(`${c.target}.tmp`, "stale\n");
      fs.chmodSync(`${c.target}.tmp`, 0o644);
      gsWrite(c, FAKE_PY, '{"org-only": {"command": "org-cmd"}}');
      assert.equal(c.rc, 0);
      const github = (
        readDoc(c) as { mcpServers: Record<string, { env: { GITHUB_TOKEN: string } }> }
      ).mcpServers["github"];
      assert.equal(github?.env.GITHUB_TOKEN, "OPERATOR-SECRET");
      expectMode600(c);
      expectNoTmp(c);
    },
  );

  test(
    "11f a <T>.tmp planted as a symlink never receives the secret nor becomes the target",
    { skip: MODE_SKIP },
    () => {
      const c = caseWith(
        '{"ui": {"theme": "x"}, "mcpServers": {"github": {"command": "gh-mcp", "env": {"GITHUB_TOKEN": "SENTINEL-11F"}}}}\n',
      );
      fs.chmodSync(c.target, 0o600);
      const planted = path.join(c.home, "planted.json");
      fs.writeFileSync(planted, "");
      fs.chmodSync(planted, 0o666);
      fs.symlinkSync(planted, `${c.target}.tmp`);
      gsWrite(c, "");
      assert.equal(c.rc, 0);
      assert.ok(!fs.readFileSync(planted, "utf8").includes("SENTINEL-11F"));
      const st = fs.lstatSync(c.target);
      assert.ok(st.isFile() && !st.isSymbolicLink());
      expectMode600(c);
      const github = (
        readDoc(c) as { mcpServers: Record<string, { env: { GITHUB_TOKEN: string } }> }
      ).mcpServers["github"];
      assert.equal(github?.env.GITHUB_TOKEN, "SENTINEL-11F");
      expectNoTmp(c);
    },
  );
});
