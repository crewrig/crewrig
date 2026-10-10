// install-workspace.test.ts — black-box contract of scripts/install-workspace.sh (spec 0255 R26;
// ticket #1334): the shell leg today, the TypeScript leg as soon as scripts/install-workspace.ts
// exists. `scripts/manage-workspace-component.sh` is replaced in the sandbox by a stub that records
// its arguments and fails for the types named in FAIL_TYPES.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { createInstallSandbox, IMPL, runEntry } from "./lib/install-sandbox.ts";
import type { Leg } from "./lib/install-sandbox.ts";

const TYPES = ["commands", "skills", "hooks", "agents", "policies", "mcp-servers", "themes"];
const sandbox = createInstallSandbox({ deps: "none" });
const log = path.join(sandbox.hermetic.root, "manage-calls");

sandbox.tree.write(
  "scripts/manage-workspace-component.sh",
  [
    "#!/bin/bash",
    `printf '%s %s\\n' "$1" "$2" >> '${log}'`,
    'echo "ran $2"',
    'case " ${FAIL_TYPES:-} " in',
    '  *" $2 "*) echo "stub failure in $2" >&2; exit 3 ;;',
    "esac",
    "exit 0",
    "",
  ].join("\n"),
  0o755,
);

const legs = (): Leg[] =>
  IMPL.filter((l) =>
    sandbox.tree.exists(`scripts/install-workspace.${l === "shell" ? "sh" : "ts"}`),
  );

/** Run every leg once with a fresh call log; `calls` is the ordered `<mode> <type>` list. */
function run(args: string[], failTypes: string[] = []) {
  return legs().map((leg) => {
    fs.rmSync(log, { force: true });
    const res = runEntry(sandbox, "install-workspace", args, {
      leg,
      env: { FAIL_TYPES: failTypes.join(" ") },
    });
    const calls = fs.existsSync(log) ? fs.readFileSync(log, "utf8").split("\n").slice(0, -1) : [];
    return { leg, ...res, calls };
  });
}

const FAILURE_TAIL =
  "Every other type was processed; only the types named above did not\n" +
  "complete. Their own reports appear above.\n";

describe("install-workspace", () => {
  it("has at least the shell leg", () => {
    assert.ok(legs().includes("shell"));
  });

  it("runs the seven types in order in the default mode install", () => {
    for (const r of run([])) {
      assert.equal(r.status, 0, r.leg);
      assert.deepEqual(
        r.calls,
        TYPES.map((t) => `install ${t}`),
        r.leg,
      );
      assert.equal(
        r.stdout,
        "Installing artifacts components (mode: install)...\n" +
          TYPES.map((t) => `ran ${t}\n`).join("") +
          "Artifacts installation complete.\n",
        r.leg,
      );
      assert.equal(r.stderr, "", r.leg);
    }
  });

  it("passes the mode argument through to every type", () => {
    for (const r of run(["link"])) {
      assert.equal(r.status, 0, r.leg);
      assert.deepEqual(
        r.calls,
        TYPES.map((t) => `link ${t}`),
        r.leg,
      );
      assert.ok(r.stdout.startsWith("Installing artifacts components (mode: link)...\n"), r.leg);
      assert.ok(r.stdout.endsWith("Artifacts installation complete.\n"), r.leg);
    }
  });

  it("runs every type when one fails, then reports it on stderr and exits 1", () => {
    for (const r of run([], ["hooks"])) {
      assert.equal(r.status, 1, r.leg);
      assert.deepEqual(
        r.calls,
        TYPES.map((t) => `install ${t}`),
        r.leg,
      );
      assert.equal(
        r.stdout,
        "Installing artifacts components (mode: install)...\n" +
          TYPES.map((t) => `ran ${t}\n`).join(""),
        r.leg,
      );
      assert.equal(
        r.stderr,
        "stub failure in hooks\n\n" +
          "Artifacts installation finished with failures in: hooks\n" +
          FAILURE_TAIL,
        r.leg,
      );
    }
  });

  it("lists several failing types in run order, with a leading space each", () => {
    for (const r of run(["link"], ["themes", "commands", "policies"])) {
      assert.equal(r.status, 1, r.leg);
      assert.deepEqual(
        r.calls,
        TYPES.map((t) => `link ${t}`),
        r.leg,
      );
      assert.ok(
        r.stderr.endsWith(
          "\nArtifacts installation finished with failures in: commands policies themes\n" +
            FAILURE_TAIL,
        ),
        r.leg,
      );
      assert.equal(r.stdout.includes("Artifacts installation complete."), false, r.leg);
    }
  });

  it("reports all seven types when every one fails", () => {
    for (const r of run([], TYPES)) {
      assert.equal(r.status, 1, r.leg);
      assert.equal(r.calls.length, 7, r.leg);
      assert.ok(r.stderr.includes(`failures in: ${TYPES.join(" ")}\n`), `${r.leg}: ${r.stderr}`);
    }
  });

  it("also runs the types after the last-position failure and the first-position one", () => {
    for (const r of run([], ["commands"])) {
      assert.equal(r.status, 1, r.leg);
      assert.equal(r.calls.length, 7, r.leg);
    }
    for (const r of run([], ["themes"])) {
      assert.equal(r.status, 1, r.leg);
      assert.equal(r.calls.at(-1), "install themes", r.leg);
    }
  });
});
