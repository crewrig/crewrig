// setup-retarget-gemini-copilot-run.test.ts — behaviour of the TypeScript Gemini and Copilot setup
// entries, run end to end in a sandboxed HOME through the golden harness (spec 0256 requirement 9,
// PR D2). It replaces two groups of static reads of the shell text:
//   - test-setup-gemini-settings-merge.sh section 13: "the Gemini setup calls neither
//     usage_capture_footprint nor usage_capture_reinject", "no PREEXISTING_MCP= rebuild of
//     settings.json" and the R15 message after each decline headline (read with grep -A1).
//   - test-system-context-store.sh (c): "no setup script mentions trustedFolders or
//     permissions-config.json in executable code" (Gemini and Copilot place the store).
//
// The run is the oracle's own cell, so the property stays pinned against the unchanged shell by the
// golden cells `gemini/gemini-settings-merge`, `gemini/transcript-optin-no`,
// `gemini/transcript-optin-apply-declined`, `gemini/decline-everywhere` and `copilot/default-answers`
// (the shell's stdout, status and file tree for the same cell). Retired with the shell text: the
// grep over executable shell lines (comment stripping, `PREEXISTING_MCP=` / `.tmp` text).

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { casesFor } from "./lib/setup-golden-all.ts";
import { runSetupCase } from "./lib/setup-golden-run.ts";
import type { Cli, GoldenCase } from "./lib/setup-golden-types.ts";
import { hasJq } from "./lib/setup-stubs.ts";

const skip =
  process.platform !== "linux"
    ? "golden cells run on Linux only"
    : !hasJq()
      ? "a real jq is required"
      : false;

interface Observed {
  readonly status: number | null;
  readonly stdout: string;
  /** Home files at the end of the run, keyed by path relative to HOME, as text. */
  readonly files: Map<string, string>;
}

function walk(dir: string, root: string, out: Map<string, string>): void {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, root, out);
    else if (entry.isFile()) out.set(path.relative(root, full), fs.readFileSync(full, "utf8"));
  }
}

/** Run the golden cell on the TypeScript leg and keep the files of the sandbox HOME before disposal. */
async function observe(cli: Cli, id: string): Promise<Observed> {
  const cell = casesFor(cli).find((c) => c.id === id);
  assert.ok(cell !== undefined, `golden cell ${cli}/${id} exists (vacuity guard)`);
  const files = new Map<string, string>();
  const withHook: GoldenCase = {
    ...cell,
    seed: (sb) => {
      cell.seed?.(sb);
      const dispose = sb.dispose.bind(sb);
      sb.dispose = () => {
        walk(sb.home, sb.home, files);
        dispose();
      };
    },
  };
  const result = await runSetupCase(withHook, "ts");
  return { status: result.status, stdout: result.stdout, files };
}

describe("Gemini setup (TypeScript entry): settings merge and decline messages", { skip }, () => {
  it("merges settings.json in place: operator keys survive, no template rebuild, no carry-over text (R15, R16)", async () => {
    const r = await observe("gemini", "gemini-settings-merge");
    assert.equal(r.status, 0, r.stdout);
    const settings = r.files.get(path.join(".gemini", "settings.json"));
    assert.ok(settings !== undefined, "settings.json landed (vacuity guard)");
    // The operator's JSONC file was merged, not rebuilt from the template: its keys are all there.
    const parsed: unknown = JSON.parse(settings);
    assert.equal((parsed as { theme?: string }).theme, "Dracula");
    assert.equal(
      (parsed as { mcpServers?: Record<string, unknown> }).mcpServers?.["operator-tool"] !==
        undefined,
      true,
      "operator MCP server kept",
    );
    assert.ok(r.stdout.includes("Merged: settings.json (existing content kept;"));
    // R16: the usage-capture carry-over of the retired rebuild is not run or mentioned.
    assert.equal(/usage.capture (footprint|carry)|reinject/i.test(r.stdout), false);
    // No leftover temp file of the old `> settings.json.tmp` rebuild.
    assert.equal(
      [...r.files.keys()].some((f) => f.endsWith("settings.json.tmp")),
      false,
    );
  });

  for (const [id, headline] of [
    ["transcript-optin-apply-declined", "Transcript activation canceled by user."],
    ["decline-everywhere", "Session recording disabled"],
  ] as const) {
    it(`${id}: the line after '${headline}' says an earlier registration is left in place (R15)`, async () => {
      const r = await observe("gemini", id);
      assert.equal(r.status, 0, r.stdout);
      const lines = r.stdout.split("\n");
      const at = lines.findIndex((l) => l.includes(headline));
      assert.ok(at >= 0, `headline printed: ${headline}`);
      const msg = lines[at + 1] ?? "";
      assert.ok(msg.includes("left in place"), msg);
      assert.equal(/rebuilt|were not kept|not carried/i.test(msg), false, msg);
    });
  }
});

describe(
  "Gemini and Copilot setups (TypeScript entries): no durable trust write for the store (R2, ADR-0013)",
  { skip },
  () => {
    for (const cli of ["gemini", "copilot"] as const) {
      it(`${cli}: no written file holds a trustedFolders key and no permissions-config.json lands`, async () => {
        const r = await observe(cli, "default-answers");
        assert.equal(r.status, 0, r.stdout);
        // Vacuity guard: the run placed the store and wrote CLI files.
        assert.ok(
          [...r.files.keys()].some((f) => f.startsWith(path.join(".crewrig", "system-context"))),
          "the system-context store was placed",
        );
        assert.ok(
          [...r.files.keys()].some((f) => f.startsWith(`.${cli}`)),
          `${cli} files written`,
        );
        assert.equal(
          [...r.files.keys()].some((f) => path.basename(f) === "permissions-config.json"),
          false,
          "no permissions-config.json",
        );
        const holders = [...r.files].filter(([f, body]) => {
          if (f.startsWith(path.join(".crewrig", "system-context"))) return false; // the store text itself
          if (!/\.json$/.test(f)) return false;
          return /"trustedFolders"/.test(body);
        });
        assert.deepEqual(
          holders.map(([f]) => f),
          [],
        );
      });
    }
  },
);
