// extension-validate-all.test.ts — `validateManifest` against the real shell `ext_validate_manifest`
// (spec 0254 R9, R22). Linux and macOS only: the shell side needs bash, jq and yq.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, test } from "node:test";

import { parseJson } from "../lib/extension/json-ordered.ts";
import type { JsonValue } from "../lib/extension/types.ts";
import { validateManifest } from "../lib/extension/validate.ts";
import { fixtures } from "./lib/extension-fixtures.ts";
import {
  LIB_DIR,
  PERCLI_KEYS_FILE,
  runShellCases,
  skipReason,
} from "./lib/shell-extension-harness.ts";

const P = "m.json";

describe("validateManifest", () => {
  test("a clean manifest earns no line", () => {
    const m = parseJson('{"name":"e","version":"1.0.0"}', P);
    assert.ok(m instanceof Map);
    assert.deepEqual(validateManifest(P, m, { libDir: LIB_DIR }), []);
  });

  test("lines come in the shell's pass order: shape, per-CLI key, hooks, MCP", () => {
    const m = parseJson(
      JSON.stringify({
        name: "e",
        components: {},
        gemini: { nope: 1 },
        hooks: "x",
        mcpServers: { mempalace: { command: "node" } },
      }),
      P,
    );
    assert.ok(m instanceof Map);
    const lines = validateManifest(P, m, { libDir: LIB_DIR });
    const at = (needle: string): number => lines.findIndex((l) => l.includes(needle));
    assert.ok(at("retired 'components'") >= 0);
    assert.ok(at("retired 'components'") < at("inadmissible per-CLI key"));
    assert.ok(at("inadmissible per-CLI key") < at("generic 'hooks' section"));
    assert.ok(at("generic 'hooks' section") < at("mempalace"));
  });

  test("an unreadable allowlist admits no per-CLI key (fail-closed)", () => {
    const m = parseJson('{"gemini":{"themes":[]}}', P);
    assert.ok(m instanceof Map);
    const lines = validateManifest(P, m, { libDir: path.join(os.tmpdir(), "no-such-lib") });
    assert.ok(lines.some((l) => l.includes("inadmissible per-CLI key 'gemini.themes'")));
  });

  describe("against the shell", { skip: skipReason || false }, () => {
    test("every fixture yields the shell's stderr, line for line", () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ext-validate-all-"));
      try {
        const cases: { label: string; file: string; manifest: Map<string, JsonValue> }[] = [];
        for (const f of fixtures) {
          let value: JsonValue;
          try {
            value = parseJson(f.json, "m.json");
          } catch {
            continue;
          }
          if (!(value instanceof Map)) continue;
          const file = path.join(dir, `${cases.length}.json`);
          fs.writeFileSync(file, f.json);
          cases.push({ label: f.label, file, manifest: value });
        }
        assert.ok(cases.length >= 8);
        const shell = runShellCases(
          cases.map((c) => c.file),
          PERCLI_KEYS_FILE,
        );
        cases.forEach((c, i) => {
          const lines = validateManifest(c.file, c.manifest, { libDir: LIB_DIR });
          const got = lines.length === 0 ? "" : `${lines.join("\n")}\n`;
          // Raw `jq: error` diagnostics the shell leaks on non-object entries are not part of the
          // contract (spec 0254 R28): compare the VALIDATION-ERROR lines only.
          const shellErr = (shell[i]?.["validate.err"] ?? "")
            .split("\n")
            .filter((l) => l.startsWith("VALIDATION-ERROR:"));
          assert.equal(got, shellErr.length === 0 ? "" : `${shellErr.join("\n")}\n`, c.label);
        });
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });
});
