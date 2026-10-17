// setup-gemini-settings-seeds.test.ts — groups G1, G2, G4, G5, G8 and G10 of
// scripts/tests/test-setup-gemini-settings-merge.sh (spec 0263): the absent-file document against an
// inline oracle, operator values over seeds, the context.fileName union, reserved MCP entries and the
// MCP precedence. The Bash case labels (1a, 2b, 4c ...) lead every test name.

import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, test } from "node:test";

import {
  COMMENT_WARN,
  FAKE_PY,
  INVALID_WARN,
  MODE_SKIP,
  ORACLE_MCP_NOPY,
  ORACLE_MEMPALACE,
  ORACLE_SEQ,
  TEMPLATE_FILES,
  caseWith,
  canon,
  docText,
  expectMode600,
  expectNoTmp,
  expectWarningBackup,
  freshDoc,
  gsWrite,
  newCase,
  readDoc,
  stdout,
} from "./lib/gemini-settings-rig.ts";

type Obj = Record<string, unknown>;
const at = (c: ReturnType<typeof newCase>, ...keys: string[]): unknown =>
  keys.reduce<unknown>((v, k) => (v as Obj)[k], readDoc(c));
const sameJson = (got: unknown, want: unknown): void => assert.equal(canon(got), canon(want));

describe("G1 absent and empty files", () => {
  test("1a fresh install with MemPalace equals the oracle, 0600, no tmp, no warning", () => {
    const c = gsWrite(newCase(), FAKE_PY);
    assert.equal(c.rc, 0);
    assert.equal(docText(c), freshDoc(FAKE_PY));
    assert.equal(canon(at(c, "mcpServers", "mempalace")), canon(ORACLE_MEMPALACE));
    expectNoTmp(c);
    assert.doesNotMatch(stdout(c), /WARNING/);
    assert.deepEqual(c.err, []);
  });
  test("1a fresh install is 0600", { skip: MODE_SKIP }, () => {
    expectMode600(gsWrite(newCase(), FAKE_PY));
  });

  test("1b fresh install without MemPalace has no mempalace key", () => {
    const c = gsWrite(newCase(), "");
    assert.equal(c.rc, 0);
    assert.equal(docText(c), freshDoc(""));
    assert.equal("mempalace" in (at(c, "mcpServers") as Obj), false);
  });

  const absent: [string, string, boolean][] = [
    ["zero-byte file", "", false],
    ["whitespace only", " \n\t\r\n  ", false],
    ["line comment only", "// only a comment\n", true],
    ["whitespace and block comment", "\n  /* a block\n comment */ \n\n", true],
  ];
  for (const [label, content, comment] of absent) {
    test(`1c ${label} is treated as absent`, () => {
      const c = gsWrite(caseWith(content), "");
      assert.equal(c.rc, 0);
      assert.equal(docText(c), freshDoc(""));
      if (process.platform !== "win32") expectMode600(c);
      assert.ok(!stdout(c).includes(INVALID_WARN));
      assert.equal(stdout(c).includes(`WARNING: ${c.target} ${COMMENT_WARN}`), comment);
    });
  }
});

describe("G2 operator content survives; seeds fill only what is absent", () => {
  test("2a operator keys kept, seeds added beside them", () => {
    const operator = {
      ui: { theme: "Dracula", hideBanner: true },
      security: { auth: { selectedType: "gemini-api-key" } },
      privacy: { telemetryOptOut: true },
      general: { vimMode: true },
      hooks: {
        Notification: [
          { matcher: "*", hooks: [{ type: "command", command: "notify-send gemini" }] },
        ],
      },
      mcpServers: {
        "acme-tools": { command: "acme", args: ["--serve"], env: { ACME_TOKEN: "xyz" } },
      },
    };
    const c = gsWrite(caseWith(JSON.stringify(operator)), FAKE_PY);
    assert.equal(c.rc, 0);
    sameJson(at(c, "ui"), operator.ui);
    // The three seed literals are a non-vacuity guard, independent of the template read.
    sameJson(at(c, "security"), {
      auth: { selectedType: "gemini-api-key" },
      folderTrust: { enabled: true },
    });
    sameJson(at(c, "privacy"), { telemetryOptOut: true, usageStatisticsEnabled: false });
    sameJson(at(c, "general"), { vimMode: true, previewFeatures: true });
    sameJson(at(c, "hooks"), operator.hooks);
    sameJson(at(c, "mcpServers", "acme-tools"), operator.mcpServers["acme-tools"]);
    sameJson(at(c, "context", "fileName"), TEMPLATE_FILES);
    if (process.platform !== "win32") expectMode600(c);
  });

  test("2b operator false, null, null ancestor and a string hooks win over seeds", () => {
    const c = gsWrite(
      caseWith(
        '{"general": {"previewFeatures": false}, "security": {"auth": {"selectedType": null}}, "privacy": null, "hooks": "operator-string"}',
      ),
      "",
    );
    assert.equal(c.rc, 0);
    assert.equal(at(c, "general", "previewFeatures"), false);
    sameJson(at(c, "security", "auth"), { selectedType: null });
    assert.equal(at(c, "privacy"), null);
    assert.equal(at(c, "hooks"), "operator-string");
  });
});

describe("G4 context.fileName is the ordered, de-duplicated union", () => {
  test("4a template list, then TEAM_NOTES.md, then LOCAL.md, once each", () => {
    const c = gsWrite(
      caseWith(
        '{"context": {"fileName": ["TEAM_NOTES.md", "AGENTS.md", "LOCAL.md", "TEAM_NOTES.md"], "loadMemoryFromIncludeDirectories": true}}',
      ),
      "",
    );
    assert.equal(c.rc, 0);
    sameJson(at(c, "context", "fileName"), [...TEMPLATE_FILES, "TEAM_NOTES.md", "LOCAL.md"]);
    assert.equal(at(c, "context", "loadMemoryFromIncludeDirectories"), true);
    assert.ok(!stdout(c).includes("'context.fileName'"));
  });

  test("4b a single string is a one-entry list, no warning", () => {
    const c = gsWrite(caseWith('{"context": {"fileName": "MINE.md"}}'), "");
    sameJson(at(c, "context", "fileName"), [...TEMPLATE_FILES, "MINE.md"]);
    assert.ok(!stdout(c).includes("'context.fileName'"));
  });

  for (const bad of ["3", '["LOCAL.md", 1]']) {
    test(`4c fileName ${bad} is replaced, warned, and the backup holds the prior bytes`, () => {
      const original = `{"context": {"fileName": ${bad}}}\n`;
      const c = gsWrite(caseWith(original), "");
      assert.equal(c.rc, 0);
      sameJson(at(c, "context", "fileName"), TEMPLATE_FILES);
      assert.ok(
        stdout(c).includes(
          `WARNING: 'context.fileName' in ${c.target} is not a string or a list of strings; it was replaced by the framework's value.`,
        ),
        stdout(c),
      );
      const i = c.out.findIndex((l) => l.includes("'context.fileName' in"));
      const backup = (c.out[i + 1] ?? "").replace(/^.*timestamped backup: /, "");
      assert.ok(backup.startsWith(`${c.target}.bak.`));
      assert.equal(fs.readFileSync(backup, "utf8"), original);
    });
  }
});

describe("G5 reserved MCP entries are replaced whole, or removed", () => {
  const stale = `{"mcpServers": {
  "acme-tools": {"command": "acme", "args": ["--serve"]},
  "mempalace": {"type": "http", "url": "http://127.0.0.1:1/mcp", "headers": {"Authorization": "Bearer STALE-SECRET"}, "trust": true},
  "sequentialthinking": {"command": "bash", "args": ["/old/tls-exec.sh", "npx", "-y", "@modelcontextprotocol/server-sequential-thinking"], "timeout": 5}
}}\n`;

  test("5a stdio registration replaces a stale HTTP entry whole", () => {
    const c = gsWrite(caseWith(stale), FAKE_PY);
    assert.equal(c.rc, 0);
    sameJson(at(c, "mcpServers", "mempalace"), ORACLE_MEMPALACE);
    sameJson(at(c, "mcpServers", "sequentialthinking"), ORACLE_SEQ);
    sameJson(at(c, "mcpServers", "acme-tools"), { command: "acme", args: ["--serve"] });
    assert.ok(!fs.readFileSync(c.target, "utf8").includes("STALE-SECRET"));
    const marker = "your prior 'mempalace' entry was replaced";
    assert.ok(
      stdout(c).includes(
        "WARNING: 'mempalace' is a framework-managed MCP server — your prior 'mempalace' entry was replaced (framework wins).",
      ),
      stdout(c),
    );
    expectWarningBackup(c, marker, stale);
  });

  test("5b without MemPalace the stale entry is removed", () => {
    const c = gsWrite(caseWith(stale), "");
    assert.equal(c.rc, 0);
    assert.equal("mempalace" in (at(c, "mcpServers") as Obj), false);
    sameJson(at(c, "mcpServers", "acme-tools"), { command: "acme", args: ["--serve"] });
    assert.ok(
      stdout(c).includes(
        "WARNING: 'mempalace' is a framework-managed MCP server — your prior 'mempalace' entry was removed (you declined it).",
      ),
    );
    expectWarningBackup(c, "your prior 'mempalace' entry was removed", stale);
  });
});

describe("G8 non-object ancestors", () => {
  test("8 string security/context/mcpServers: seeds only where an object is replaced", () => {
    const original = '{"security": "x", "context": "y", "mcpServers": "z"}\n';
    const c = gsWrite(caseWith(original), "");
    assert.equal(c.rc, 0);
    assert.equal(at(c, "security"), "x");
    assert.doesNotMatch(stdout(c).replaceAll(c.target, "<T>"), /security/);
    sameJson(at(c, "context"), { fileName: TEMPLATE_FILES });
    sameJson(at(c, "mcpServers"), ORACLE_MCP_NOPY);
    for (const key of ["context", "mcpServers"]) {
      assert.ok(
        stdout(c).includes(
          `WARNING: '${key}' in ${c.target} is not an object; it was replaced by the framework's value.`,
        ),
        stdout(c),
      );
    }
    expectWarningBackup(c, "'context' in", original);
  });
});

describe("G10 MCP precedence: framework-reserved > org > operator", () => {
  test("10 org wins over operator, org-only added, framework keeps its reserved name", () => {
    const original =
      '{"mcpServers": {"acme-tools": {"command": "operator-acme"}, "zeta": {"command": "zeta"}}}\n';
    const c = gsWrite(
      caseWith(original),
      FAKE_PY,
      '{"acme-tools": {"command": "org-acme"}, "org-only": {"command": "org-cmd"}, "mempalace": {"command": "org-mem"}}',
    );
    assert.equal(c.rc, 0);
    sameJson(at(c, "mcpServers", "acme-tools"), { command: "org-acme" });
    sameJson(at(c, "mcpServers", "org-only"), { command: "org-cmd" });
    sameJson(at(c, "mcpServers", "zeta"), { command: "zeta" });
    sameJson(at(c, "mcpServers", "mempalace"), ORACLE_MEMPALACE);
    assert.ok(
      stdout(c).includes(
        "WARNING: org-declared MCP server 'acme-tools' overrides your pre-existing 'acme-tools' entry (org declaration wins).",
      ),
      stdout(c),
    );
    expectWarningBackup(c, "org-declared MCP server 'acme-tools'", original);
    assert.ok(
      stdout(c).includes(
        "WARNING: 'mempalace' is a framework-managed MCP server — the org declaration for 'mempalace' was NOT applied (framework wins).",
      ),
    );
  });
});
