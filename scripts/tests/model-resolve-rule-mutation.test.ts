// model-resolve-rule-mutation.test.ts — the TypeScript substitutes of the retired shell
// suite's mutation cases M7, M8, M11 and O8 (spec 0262 requirement 17).
//
// Each mutation is applied to a COPY of `scripts/lib/model-resolve*` made under a fresh
// `mkdtemp` directory; the tree is never edited. An anchor that no longer matches fails the
// case, so a mutation cannot be vacuous. M7: the (g)(0) eligibility condition (i) removed
// from the resolver; M11: the merge cache short-circuit removed; O8: the accessor bodies of
// `mapping-access.ts` hashed against a fixture, and M8: one byte in an untouched accessor
// turns that guard red.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { pathToFileURL } from "node:url";

import { createResolveContext, resolveAgent } from "../lib/model-resolve.ts";
import {
  cleanupTmp,
  makeRun,
  mkTmp,
  offering,
  orgRoot,
  realRoot,
  REPO,
  writeProfile,
} from "./fixtures/build-components/model-resolve-kit.ts";

const [L, M] = ["scripts/lib/", "scripts/lib/model-resolve/"];
const ACCESS = `${M}mapping-access.ts`;
const GOLDEN = path.join(REPO, "scripts/tests/fixtures/model-resolve-ts-accessor-hashes.txt");
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "rule-mutation-"));
after(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
  cleanupTmp();
});

/** A copy of the twin sources under `scratch` with `from` replaced by `to` in `file`. */
function copyWith(file: string, from: string, to: string): string {
  const dir = fs.mkdtempSync(path.join(scratch, "copy-"));
  for (const sub of [L, M]) {
    fs.mkdirSync(path.join(dir, sub), { recursive: true });
    for (const f of fs.readdirSync(path.join(REPO, sub), { withFileTypes: true })) {
      if (f.isFile() && f.name.endsWith(".ts"))
        fs.copyFileSync(path.join(REPO, sub, f.name), path.join(dir, sub, f.name));
    }
  }
  const target = path.join(dir, file);
  const text = fs.readFileSync(target, "utf8");
  assert.ok(text.includes(from), `anchor not found in ${file}: ${from}`);
  fs.writeFileSync(target, text.replace(from, to));
  return dir;
}

const load = async <T>(dir: string, file: string): Promise<T> =>
  (await import(pathToFileURL(path.join(dir, file)).href)) as T;
type Resolver = Pick<
  typeof import("../lib/model-resolve.ts"),
  "createResolveContext" | "resolveAgent"
>;

describe("M7: the (g)(0) condition (i) is load-bearing", () => {
  // Rule (b): a profile with `reasoning` and no intelligence disposes reasoning once; the
  // eligibility gate keeps every undeclared item (here `model`) out of the rest of the rule.
  const diagCount = (api: Resolver): number => {
    const dir = mkTmp("m7");
    const source = writeProfile(dir, "reasoning: medium");
    const run = makeRun(realRoot());
    const ctx = api.createResolveContext({ ...run.ctx });
    return api.resolveAgent(ctx, "probe", source, "claude").diagLines.length;
  };
  test("the control: exactly one record", () => {
    assert.equal(diagCount({ createResolveContext, resolveAgent }), 1);
  });
  test("removing the condition adds a record", async () => {
    const dir = copyWith(
      `${M}resolve-item.ts`,
      "!profileDeclaresItem(state.profile, item) ||",
      "false ||",
    );
    assert.notEqual(diagCount(await load<Resolver>(dir, `${L}model-resolve.ts`)), 1);
  });
});

describe("M11: the merge cache short-circuit is load-bearing", () => {
  const ORG = `target: claude\nofferings:\n${offering("zed", 9, "zed-native", "high")}\n`;
  const merges = (api: Resolver): number => {
    const mergeDir = mkTmp("m11");
    const source = writeProfile(mkTmp("m11src"), "intelligence: high");
    const run = makeRun(orgRoot("claude", ORG), { MAPPING_MERGE_DIR: mergeDir });
    const ctx = api.createResolveContext({ ...run.ctx });
    api.resolveAgent(ctx, "probe", source, "claude");
    api.resolveAgent(ctx, "probe", source, "claude");
    return fs.readFileSync(path.join(mergeDir, ".merges"), "utf8").split("\n").filter(Boolean)
      .length;
  };
  test("the control: one merge for one pair resolved twice", () => {
    assert.equal(merges({ createResolveContext, resolveAgent }), 1);
  });
  test("an unconditional merge writes two", async () => {
    const dir = copyWith(
      `${M}merge-mapping.ts`,
      "if (isFile(out)) return out;",
      "if (false) return out;",
    );
    assert.equal(merges(await load<Resolver>(dir, `${L}model-resolve.ts`)), 2);
  });
});

/** `name<TAB>sha256` of every top-level function block of a module, sorted. */
function blockHashes(text: string): string[] {
  const out: string[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = /^(?:export )?function (\w+)\(/.exec(lines[i] ?? "");
    if (m === null) continue;
    let j = i;
    while (j < lines.length && !/^}/.test(lines[j] ?? "")) j++;
    const body = lines.slice(i, j + 1).join("\n");
    out.push(`${m[1]}\t${createHash("sha256").update(body).digest("hex")}`);
  }
  return out.sort();
}
const golden = fs.readFileSync(GOLDEN, "utf8").split("\n").filter(Boolean);

describe("O8 and M8: the accessor bodies cannot change silently", () => {
  /** The accessors deleted from, or differing from, the golden. */
  const drift = (text: string): string[] => {
    const now = new Map(blockHashes(text).map((l) => l.split("\t") as [string, string]));
    return golden.flatMap((l) => {
      const [name = "", hash = ""] = l.split("\t");
      return now.get(name) === hash ? [] : [name];
    });
  };
  test("O8: every accessor of mapping-access.ts is byte-identical to the fixture", () => {
    assert.ok(golden.length >= 12, `${golden.length} accessors pinned`);
    assert.deepEqual(drift(fs.readFileSync(path.join(REPO, ACCESS), "utf8")), []);
  });
  test("M8: one byte in an untouched accessor (itemKey) turns O8 red", () => {
    const dir = copyWith(
      ACCESS,
      "export function itemKey(yaml: YamlText, doc: MappingDoc, addr: string, item: string): string {",
      "export function itemKey(yaml: YamlText, doc: MappingDoc, addr: string, item: string): string {\n  void 0;",
    );
    assert.deepEqual(drift(fs.readFileSync(path.join(dir, ACCESS), "utf8")), ["itemKey"]);
  });
});
