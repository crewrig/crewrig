// windows-model-ci-tooling-models.test.ts — the cross-system proof of check-agent-profiles.ts and
// check-model-mappings.ts (spec 0262 R21-R23, R26). From PowerShell on Windows (the default shell
// elsewhere, so the file also passes in Linux CI) each entry runs against the real repository
// (verdict OK, status 0) and against a scratch fixture that makes it fail (FAILED line, status 1);
// check-model-mappings.ts --print-selection runs on a real mapping. Interpreters are resolved from
// the PARENT PATH before the child PATH is narrowed. The `windows-model-ci-tooling` job runs every
// `windows-model-ci-tooling-*.test.ts` file.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { defaultIsFile } from "../lib/worktree-claim/launch-windows.ts";
import { expectStatus, resolveInterpreters, spawnEntry, why } from "./lib/windows-proof-support.ts";
import type { Run } from "./lib/windows-proof-support.ts";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const entries = {
  profiles: path.join(repo, "scripts", "check-agent-profiles.ts"),
  mappings: path.join(repo, "scripts", "check-model-mappings.ts"),
};

function withBox<T>(body: (root: string, bin: string) => T): T {
  const root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "windows-model-ci-tooling-")),
  );
  try {
    const bin = path.join(root, "bin");
    fs.mkdirSync(bin);
    return body(root, bin);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function run(which: keyof typeof entries, args: string[], root: string, bin: string): Run {
  // Resolved from the parent environment, before spawnEntry narrows the child PATH.
  const interpreters = resolveInterpreters({
    platform: process.platform,
    env: process.env,
    isFile: defaultIsFile,
  });
  const label = `${which} ${args.map((a) => path.basename(a)).join(" ")}`.trim();
  console.log(`windows-model-ci-tooling-models: ${label}: ${interpreters.notes.join("; ")}`);
  return spawnEntry({
    entry: label,
    script: entries[which],
    args,
    shell: "pwsh",
    env: {
      GIT_CONFIG_NOSYSTEM: "1",
      NODE_OPTIONS: "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
      CREWRIG_REPO_DIR: repo,
    },
    home: root,
    bin,
    cwd: repo,
    interpreters,
  });
}

/** One stderr line of the verdict, with the CRLF a PowerShell pipe may add normalised. */
const lines = (text: string): string[] => text.replaceAll("\r\n", "\n").split("\n");

describe("windows model-ci-tooling: check-agent-profiles", () => {
  it("accepts the real repository: OK verdict, status 0", () => {
    withBox((root, bin) => {
      const r = run("profiles", [], root, bin);
      expectStatus(r, 0);
      assert.match(r.out, /^OK: \d+ agent source\(s\) checked;/, why(r, "OK verdict"));
    });
  });

  it("rejects an unknown profile in a scratch agent source: FAILED line, status 1", () => {
    withBox((root, bin) => {
      const file = path.join(root, "AGENT.md");
      fs.writeFileSync(
        file,
        "---\nname: x\nmetadata:\n  model:\n    profile: not-a-real-profile\n---\n\nbody\n",
      );
      const r = run("profiles", [file], root, bin);
      expectStatus(r, 1);
      assert.ok(
        lines(r.err).some((l) => l.startsWith("FAILED: ")),
        why(r, "FAILED line on stderr"),
      );
    });
  });
});

describe("windows model-ci-tooling: check-model-mappings", () => {
  it("accepts the real mapping files: OK verdict, status 0", () => {
    withBox((root, bin) => {
      const r = run("mappings", [], root, bin);
      expectStatus(r, 0);
      assert.match(r.out, /^OK: \d+ mapping file\(s\) conform\./, why(r, "OK verdict"));
    });
  });

  it("rejects a scratch mapping that does not parse: FAILED line, status 1", () => {
    withBox((root, bin) => {
      const file = path.join(root, "broken.yml");
      fs.writeFileSync(file, "target: [unclosed\n");
      const r = run("mappings", [file], root, bin);
      expectStatus(r, 1);
      assert.ok(
        lines(r.err).some((l) => l.startsWith("FAILED: ")),
        why(r, "FAILED line on stderr"),
      );
    });
  });

  it("prints the selection of a real mapping with --print-selection", () => {
    withBox((root, bin) => {
      const mapping = path.join(repo, "model-mappings", "gemini.yml");
      const r = run("mappings", ["--print-selection", mapping], root, bin);
      expectStatus(r, 0);
      const rows = lines(r.out).filter(Boolean);
      assert.ok(rows.length > 0, why(r, "selection rows"));
      for (const row of rows) assert.equal(row.split("\t").length, 3, why(r, `row ${row}`));
    });
  });
});
