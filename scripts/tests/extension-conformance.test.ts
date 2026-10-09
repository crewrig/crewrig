// extension-conformance.test.ts — the shell libraries and their TypeScript twins, over the same
// manifests (spec 0254 R22): the validator lines, the hook translation, the hook gaps, the closed
// event set and the MCP delivery. The shell side is one `bash` sourcing the repository's libraries;
// the twin side is the TypeScript modules. A difference is a failing case, never papered over.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

import { fixtures } from "./lib/extension-fixtures.ts";
import {
  LIB_DIR,
  PERCLI_KEYS_FILE,
  runShellCases,
  skipReason,
  type CaseOutput,
} from "./lib/shell-extension-harness.ts";
import { readPerCliKeys, readTargetTable } from "../lib/extension/descriptors.ts";
import { gapToJson } from "../lib/extension/gap-record.ts";
import { renderHookFile } from "../lib/extension/hooks-emit.ts";
import { hookGaps } from "../lib/extension/hooks-resolve.ts";
import { knownEvents } from "../lib/extension/hooks-vocab.ts";
import { parseJson } from "../lib/extension/json-ordered.ts";
import { writeJsonCompact, writeJsonText } from "../lib/extension/json-write.ts";
import { mcpDelivery, mcpNative } from "../lib/extension/mcp-delivery.ts";
import { assertCurrentShape } from "../lib/extension/shape-guard.ts";
import { TARGETS } from "../lib/extension/types.ts";
import type { JsonValue, Target } from "../lib/extension/types.ts";
import { validateHooks } from "../lib/extension/validate-hooks.ts";
import {
  validateMcpNames,
  validateMcpShape,
  validateMcpTokens,
} from "../lib/extension/validate-mcp.ts";
import { validatePerCli } from "../lib/extension/validate-percli.ts";
import { MCP_RESERVED_NAMES } from "../lib/org-mcp.ts";

const table = readTargetTable(LIB_DIR);
const allowed = readPerCliKeys(LIB_DIR);
const lines = (text: string, prefix: string): string[] =>
  text.split("\n").filter((l) => l.startsWith(prefix));

interface Case {
  readonly label: string;
  readonly file: string;
  readonly manifest: Map<string, JsonValue>;
  shell: CaseOutput;
}

let dir = "";
const cases: Case[] = [];

describe("extension shell/TypeScript conformance", { skip: skipReason || false }, () => {
  before(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ext-conformance-"));
    fixtures.forEach((f, i) => {
      const file = path.join(dir, `m${i}.json`);
      fs.writeFileSync(file, f.json);
      const manifest = parseJson(f.json, file);
      assert.ok(manifest instanceof Map, `${f.label}: fixtures are objects`);
      cases.push({ label: f.label, file, manifest, shell: {} });
    });
    const outputs = runShellCases(
      cases.map((c) => c.file),
      PERCLI_KEYS_FILE,
    );
    cases.forEach((c, i) => (c.shell = outputs[i] ?? {}));
  });
  after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const each = (name: string, check: (c: Case) => void): void => {
    describe(name, () => {
      fixtures.forEach((f, i) => test(f.label, () => check(cases[i] as Case)));
    });
  };

  test("fixture labels are unique", () => {
    const labels = fixtures.map((f) => f.label);
    assert.equal(new Set(labels).size, labels.length);
  });

  each("validator lines, in the shell's order", (c) => {
    // Only the VALIDATION-ERROR lines: jq's own diagnostics on stderr are not behaviour.
    const twin = [
      ...assertCurrentShape(c.file, c.manifest, LIB_DIR),
      ...validatePerCli(c.file, c.manifest, PERCLI_KEYS_FILE, allowed),
      ...validateHooks(c.file, c.manifest),
      ...validateMcpShape(c.file, c.manifest),
      ...validateMcpTokens(c.file, c.manifest),
      ...validateMcpNames(c.file, c.manifest, MCP_RESERVED_NAMES),
    ];
    assert.deepEqual(twin, lines(out(c, "validate.err"), "VALIDATION-ERROR:"));
  });

  each("hook files rendered per target", (c) => {
    for (const target of TARGETS) {
      const file = renderHookFile(target, c.manifest, table);
      const twin = file === null ? {} : { [file.file]: writeJsonText(file.value) };
      const prefix = `render-${target}${path.sep}`;
      const shell = Object.fromEntries(
        Object.entries(c.shell)
          .filter(([k]) => k.startsWith(prefix))
          .map(([k, v]) => [k.slice(prefix.length), v]),
      );
      assert.deepEqual(twin, shell, target);
    }
  });

  each("hook gaps per target: records and warnings", (c) => {
    for (const target of TARGETS) {
      const { gaps, warnings } = hookGaps(target, c.manifest, table);
      const records = gaps.map((g) => `${writeJsonCompact(gapToJson(g))}\n`).join("");
      assert.equal(records, out(c, `gaps-${target}.out`), `${target} records`);
      assert.deepEqual(warnings, lines(out(c, `gaps-${target}.err`), "Warning:"), target);
    }
  });

  each("closed hook event set", (c) => {
    assert.deepEqual(knownEvents(), out(c, "known.out").split("\n").slice(0, -1));
  });

  each("MCP delivery gate per target", (c) => {
    for (const target of TARGETS)
      assert.equal(String(mcpDelivery(target, table)), out(c, `delivery-${target}.out`).trim());
  });

  each("MCP native declaration per target", (c) => {
    for (const target of TARGETS) assertNative(c, target);
  });
});

/** Shell: stdout of `ext_mcp_native` and its status; the twin: compact JSON, or a throw. */
function assertNative(c: Case, target: Target): void {
  const shell = out(c, `native-${target}.out`).replace(/\n$/, "");
  const status = Number(out(c, `native-${target}.status`));
  let twin: string;
  try {
    twin = writeJsonCompact(mcpNative(target, c.manifest, table));
  } catch (error) {
    twin = `throws: ${(error as Error).message}`;
  }
  // deviation: spec 0254 R28 (to be recorded by delta-01): a server that is neither an object nor
  // null makes the shell's whole translation fail silently (empty output) where the twin refuses it.
  if (NON_OBJECT_SERVER.test(c.label)) {
    assert.equal(shell, "", `${target}: the shell's silent failure`);
    assert.match(twin, /^throws: mcpServers\.\S+ is not an object$/);
    return;
  }
  assert.equal(twin, shell, `${target} (shell status ${status})`);
}
const NON_OBJECT_SERVER = /^mcp: entry is a string$/;
function out(c: Case, name: string): string {
  return c.shell[name] ?? "";
}
