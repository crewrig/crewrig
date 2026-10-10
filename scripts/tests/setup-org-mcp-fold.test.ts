// setup-org-mcp-fold.test.ts — org-mcp-fold.ts (scripts/lib/setup/org-mcp-fold.ts) against temporary directories only.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { parseJson } from "../lib/extension/json-ordered.ts";
import type { JsonValue } from "../lib/extension/types.ts";
import { SetupExit } from "../lib/setup/exit.ts";
import {
  applyOrgMcpServers,
  foldOrgMcpNative,
  readOrgMcpManifest,
  reservedOrgWarning,
} from "../lib/setup/org-mcp-fold.ts";

const posix = process.platform !== "win32";
let dir: string;
let out: string[];
let err: string[];

beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "setup-org-mcp-")));
  out = [];
  err = [];
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const ctx = (platform: NodeJS.Platform = process.platform) => ({
  io: { out: (l: string) => out.push(l), err: (l: string) => err.push(l) },
  platform,
});
const map = (text: string): Map<string, JsonValue> =>
  parseJson(text, "t") as Map<string, JsonValue>;
const manifestFile = (text: string): void =>
  fs.writeFileSync(path.join(dir, "mcp-servers.org.json"), text);
const json = (v: JsonValue | undefined): string =>
  JSON.stringify(v instanceof Map ? Object.fromEntries(v) : v);

describe("readOrgMcpManifest", () => {
  it("is empty when the file is absent", () => assert.equal(readOrgMcpManifest(dir).size, 0));

  it("reads .mcpServers in file order and ignores sibling keys", () => {
    manifestFile(
      '{"_note":"x","mcpServers":{"b":{"command":"c"},"a":{"url":"u","transport":"http"}}}',
    );
    assert.deepEqual([...readOrgMcpManifest(dir).keys()], ["b", "a"]);
  });

  it("degrades to empty on empty, malformed, non-object and missing .mcpServers", () => {
    for (const text of [
      "",
      "{nope",
      "[1]",
      '"s"',
      "{}",
      '{"mcpServers":null}',
      '{"mcpServers":[1]}',
      '{"mcpServers":"x"}',
    ]) {
      manifestFile(text);
      assert.equal(readOrgMcpManifest(dir).size, 0, text);
    }
    assert.deepEqual([out, err], [[], []]);
  });
});

describe("foldOrgMcpNative", () => {
  const manifest =
    '{"zeta":{"command":"z","args":["1"]},"alpha":{"transport":"http","url":"https://a"}}';

  it("adds org entries after the framework ones, translated for the CLI", () => {
    const current = map('{"mempalace":{"command":"m"},"github":{"command":"g"}}');
    const r = foldOrgMcpNative(ctx(), "gemini", map(manifest), current);
    assert.deepEqual([...r.keys()], ["mempalace", "github", "zeta", "alpha"]);
    assert.equal(json(r.get("zeta")), '{"command":"z","args":["1"]}');
    assert.equal(json(r.get("alpha")), '{"httpUrl":"https://a"}');
    assert.equal(
      json(foldOrgMcpNative(ctx(), "copilot", map(manifest), new Map()).get("zeta")),
      '{"command":"z","args":["1"],"type":"stdio"}',
    );
    assert.equal(
      json(foldOrgMcpNative(ctx(), "antigravity", map(manifest), new Map()).get("alpha")),
      '{"serverUrl":"https://a"}',
    );
    assert.deepEqual(out, []);
  });

  it("refuses a reserved name with the shell's message; framework entry stays", () => {
    const current = map('{"mempalace":{"command":"framework"}}');
    const m = map(
      '{"mempalace":{"command":"org"},"sequentialthinking":{"command":"o2"},"ok":{"command":"k"}}',
    );
    const r = foldOrgMcpNative(ctx(), "claude", m, current);
    assert.equal(json(r.get("mempalace")), '{"command":"framework"}');
    assert.ok(!r.has("sequentialthinking"));
    assert.ok(r.has("ok"));
    assert.deepEqual(out, [
      "  WARNING: 'mempalace' is a framework-managed MCP server — the org declaration for 'mempalace' was NOT applied (framework wins).",
      "  WARNING: 'sequentialthinking' is a framework-managed MCP server — the org declaration for 'sequentialthinking' was NOT applied (framework wins).",
    ]);
    assert.equal(out[0], reservedOrgWarning("mempalace"));
  });

  it("org wins over the operator's pre-existing entry, warning in code-point order with the backup", () => {
    const current = map(
      '{"zeta":{"command":"operator"},"alpha":{"command":"operator"},"keep":{"command":"k"}}',
    );
    const pre = map(
      '{"zeta":{"command":"operator"},"alpha":{"command":"operator"},"keep":{"command":"k"}}',
    );
    const r = foldOrgMcpNative(ctx(), "gemini", map(manifest), current, pre, "/b/x.bak.1");
    assert.deepEqual([...r.keys()], ["zeta", "alpha", "keep"]);
    assert.equal(json(r.get("zeta")), '{"command":"z","args":["1"]}');
    assert.deepEqual(out, [
      "  WARNING: org-declared MCP server 'alpha' overrides your pre-existing 'alpha' entry (org declaration wins).",
      "           The prior entry is preserved in the timestamped backup: /b/x.bak.1",
      "  WARNING: org-declared MCP server 'zeta' overrides your pre-existing 'zeta' entry (org declaration wins).",
      "           The prior entry is preserved in the timestamped backup: /b/x.bak.1",
    ]);
  });

  it("names (none) when there is no backup, and does not mutate its inputs", () => {
    const current = map('{"a":{"command":"old"}}');
    foldOrgMcpNative(ctx(), "gemini", map('{"a":{"command":"new"}}'), current, current);
    assert.equal(
      out[1],
      "           The prior entry is preserved in the timestamped backup: (none)",
    );
    assert.equal(json(current.get("a")), '{"command":"old"}');
  });

  it("returns the servers unchanged and silent when nothing is declared", () => {
    const current = map('{"a":{"command":"x"}}');
    assert.deepEqual(foldOrgMcpNative(ctx(), "gemini", new Map(), current), current);
    assert.deepEqual(out, []);
  });

  it("ignores a manifest the translator refuses, with a warning, and folds nothing", () => {
    const r = foldOrgMcpNative(ctx(), "gemini", map('{"a":"not an object"}'), new Map());
    assert.equal(r.size, 0);
    assert.match(
      err[0] ?? "",
      /^ {2}WARNING: the org MCP manifest is ignored: mcpServers\.a is not an object$/,
    );
  });
});

describe("applyOrgMcpServers", () => {
  let file: string;
  beforeEach(() => {
    file = path.join(dir, "mcp-config.json");
  });
  const manifest = '{"org":{"command":"o"},"mempalace":{"command":"x"}}';

  it("folds into the file's mcpServers, writes jq-formatted, no backup of its own", () => {
    fs.writeFileSync(file, '{"top":1,"mcpServers":{"mempalace":{"command":"m"}}}');
    assert.equal(applyOrgMcpServers(ctx(), "copilot", map(manifest), file, new Map(), ""), true);
    assert.equal(
      fs.readFileSync(file, "utf8"),
      '{\n  "top": 1,\n  "mcpServers": {\n    "mempalace": {\n      "command": "m"\n    },\n    "org": {\n      "command": "o",\n      "type": "stdio"\n    }\n  }\n}\n',
    );
    assert.deepEqual(fs.readdirSync(dir), ["mcp-config.json"]);
    assert.equal(out.length, 1);
    if (posix) assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  });

  it("creates mcpServers at the end when absent or null", () => {
    fs.writeFileSync(file, '{"a":1,"mcpServers":null,"b":2}');
    applyOrgMcpServers(ctx(), "gemini", map('{"o":{"command":"c"}}'), file, new Map(), "");
    assert.deepEqual([...map(fs.readFileSync(file, "utf8")).keys()], ["a", "mcpServers", "b"]);
    fs.writeFileSync(file, '{"a":1}');
    applyOrgMcpServers(ctx(), "gemini", map('{"o":{"command":"c"}}'), file, new Map(), "");
    assert.deepEqual([...map(fs.readFileSync(file, "utf8")).keys()], ["a", "mcpServers"]);
  });

  it("does not touch the file when nothing is declared", () => {
    fs.writeFileSync(file, '{"compact":true}');
    assert.equal(applyOrgMcpServers(ctx(), "gemini", new Map(), file, new Map(), ""), false);
    assert.equal(fs.readFileSync(file, "utf8"), '{"compact":true}');
  });

  it("fails with one Error line when the config is invalid or mcpServers is not an object", () => {
    for (const [text, tail] of [
      ['{"a":', "is not valid JSON"],
      ['{"mcpServers":[1]}', "mcpServers is not an object"],
      ["[1]", "is not a JSON object"],
    ] as const) {
      err.length = 0;
      fs.writeFileSync(file, text);
      assert.throws(
        () =>
          applyOrgMcpServers(ctx(), "gemini", map('{"o":{"command":"c"}}'), file, new Map(), ""),
        (e: unknown) => e instanceof SetupExit && e.status === 1,
      );
      assert.equal(err.length, 1);
      assert.ok((err[0] ?? "").startsWith("Error: ") && (err[0] ?? "").includes(tail), err[0]);
      assert.equal(fs.readFileSync(file, "utf8"), text);
    }
  });
});
