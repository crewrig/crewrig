// Replaces artifacts/library/skills/harness-curator/scripts/test.sh groups G10 (unit half) and G11
// (spec 0265 row J2, spec 0105, issue #1272): apply.py helpers loaded through importlib (`pyEval`,
// python3 -I). No forge binary is run and no MemPalace is imported (the import is function-local to
// main()). POSIX only. The argv half of G10 lives in harness-curator-apply-dry-run.test.ts.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import { pyEval, python3, SCRIPTS_DIR, SKIP_WIN32 } from "./lib/harness-curator-py.ts";

const skip = SKIP_WIN32 ?? (python3() === undefined ? "python3 not found" : undefined);
const apply = (snippet: string, env: NodeJS.ProcessEnv = {}): string =>
  pyEval("apply.py", snippet, env);
const dedup = (forge: string, ref: string): string =>
  `c = m._dedup_list_cmd("${forge}", "${ref}", "k"); `;
const match = (items: string, key = "k"): string =>
  apply(`OUT = m._match_existing(${items}, "${key}")`);
const T = (t: string, extra = ""): string => `{"title":"${t}"${extra}}`;

describe("G10 dedup list command per forge", { skip }, () => {
  test("G10 dedup: gitea --fields index,title,state,url (the ,url is load-bearing)", () => {
    const code = `${dedup("gitea", "o/r")}OUT = (c[c.index("--fields")+1] == "index,title,state,url")`;
    assert.equal(apply(code), "True");
  });

  test("G10 dedup: gitea --output json", () => {
    assert.equal(
      apply(`${dedup("gitea", "o/r")}OUT = (c[c.index("--output")+1] == "json")`),
      "True",
    );
  });

  test("G10 dedup: gitlab --output json", () => {
    assert.equal(
      apply(`${dedup("gitlab", "ref")}OUT = (c[c.index("--output")+1] == "json")`),
      "True",
    );
  });

  test("G10 dedup: gitlab has --per-page", () => {
    assert.equal(apply(`${dedup("gitlab", "ref")}OUT = ("--per-page" in c)`), "True");
  });

  test("G10 dedup: github --json title,url", () => {
    assert.equal(apply(`${dedup("github", "o/r")}OUT = c[c.index("--json")+1]`), "title,url");
  });

  test("G10 dedup: github search uses in:title", () => {
    assert.equal(apply(`${dedup("github", "o/r")}OUT = any("in:title" in x for x in c)`), "True");
  });
});

describe("G10 _match_existing", { skip }, () => {
  const own = "Friction cluster: k (2 reports)";

  test("G10 match: truthy on a title match with no url field", () => {
    assert.equal(apply(`OUT = bool(m._match_existing([${T(own)}], "k"))`), "True");
  });

  test("G10 match: returns html_url when present", () => {
    assert.equal(match(`[${T(own, ',"html_url":"u"')}]`), "u");
  });

  test("G10 match: None on no title match", () => {
    assert.equal(match(`[${T("unrelated")}]`), "None");
  });

  test("G10 match: the trailing ( anchor blocks the k vs k-merge collision", () => {
    assert.equal(match(`[${T("Friction cluster: k-merge (2 reports)")}]`), "None");
  });

  test("G10 match delta-02 R5: matches a Gitmoji-prefixed title (own key)", () => {
    const items = `[${T("\u{1F41B} Friction cluster: yq (3 reports)")}]`;
    assert.equal(apply(`OUT = bool(m._match_existing(${items}, "yq"))`), "True");
  });

  test("G10 match delta-02 R5: a Gitmoji-prefixed sibling key does not collide", () => {
    assert.equal(match(`[${T("\u{1F3A8} Friction cluster: yq-merge (2 reports)")}]`, "yq"), "None");
  });

  test("G10 match delta-02 R5: still matches an un-prefixed pre-existing title", () => {
    const items = `[${T("Friction cluster: yq (3 reports)")}]`;
    assert.equal(apply(`OUT = bool(m._match_existing(${items}, "yq"))`), "True");
  });

  test("G10 match delta-02 R5: returns the un-prefixed title verbatim via (a)", () => {
    assert.equal(
      match(`[${T("Friction cluster: yq (3 reports)")}]`, "yq"),
      "Friction cluster: yq (3 reports)",
    );
  });

  test("G10 match delta-02 R5: strips exactly one leading token, not more", () => {
    assert.equal(match(`[${T("\u{1F41B} extra Friction cluster: yq (3 reports)")}]`, "yq"), "None");
  });
});

describe("G10 fail-open", { skip }, () => {
  let empty = "";
  before(() => {
    empty = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "crewrig-hc-path-")));
  });
  after(() => {
    fs.rmSync(empty, { recursive: true, force: true });
  });

  test("G10 fail-open: existing_issue_url returns None when the forge binary is missing", () => {
    // PATH is an empty directory we created: subprocess raises FileNotFoundError, which a narrow
    // except tuple would let escape; the deliberate `except Exception` must swallow it.
    const out = apply('OUT = (m._existing_issue_url("gitea","o/r","k") is None)', { PATH: empty });
    assert.equal(out, "True");
  });
});

describe("G11 _stamp_drawer write-back verification (issue #1272)", { skip }, () => {
  test("G11 stamp A: False when update_drawer reports success:false without raising", () => {
    const out = apply(
      'm.tool_get_drawer = lambda **kw: {"content": "original"}; ' +
        'm.tool_update_drawer = lambda **kw: {"success": False, "error": "nope"}; ' +
        'OUT = (m._stamp_drawer("id", "http://x") is False)',
    );
    assert.equal(out, "True");
  });

  test("G11 stamp B: False on a pre-update get_drawer error, update_drawer never called", () => {
    // Calls are recorded in a list: an AssertionError thrown by the stub would be swallowed by
    // _stamp_drawer's own `except Exception`.
    const out = apply(
      [
        "_upd = []",
        'm.tool_get_drawer = lambda **kw: {"error": "not found"}',
        "m.tool_update_drawer = lambda **kw: _upd.append(1)",
        'OUT = (m._stamp_drawer("id", "http://x") is False) and (_upd == [])',
      ].join("\n"),
    );
    assert.equal(out, "True");
  });

  test("G11 stamp B2: get_drawer raises: False, no update_drawer call, no crash", () => {
    const out = apply(
      [
        "_upd = []",
        "def _get(**kw):",
        '    raise RuntimeError("boom")',
        "m.tool_get_drawer = _get",
        "m.tool_update_drawer = lambda **kw: _upd.append(1)",
        'OUT = (m._stamp_drawer("id", "http://x") is False) and (_upd == [])',
      ].join("\n"),
    );
    assert.equal(out, "True");
  });

  test("G11 stamp C: False on a lying success, with exactly 2 get_drawer calls", () => {
    const out = apply(
      [
        "_calls = []",
        "def _get(**kw):",
        "    _calls.append(1)",
        '    return {"content": "original"}',
        "m.tool_get_drawer = _get",
        'm.tool_update_drawer = lambda **kw: {"success": True}',
        'OUT = (m._stamp_drawer("id", "http://example.com/1") is False) and (len(_calls) == 2)',
      ].join("\n"),
    );
    assert.equal(out, "True");
  });

  test("G11 global: the global line immediately precedes the mempalace import (both located)", () => {
    const lines = fs.readFileSync(path.join(SCRIPTS_DIR, "apply.py"), "utf8").split("\n");
    const imp = lines.findIndex(
      (l) => l.trim() === "from mempalace.mcp_server import tool_get_drawer, tool_update_drawer",
    );
    assert.notEqual(imp, -1, "the mempalace import line was not found");
    const glob = lines.findIndex((l) => l.trim() === "global tool_get_drawer, tool_update_drawer");
    assert.notEqual(glob, -1, "the global line was not found");
    assert.equal(glob, imp - 1);
  });
});
