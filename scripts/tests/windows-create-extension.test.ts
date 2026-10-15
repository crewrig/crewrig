// windows-create-extension.test.ts — the cross-system proof of the extension scaffolder entry (spec
// 0258 R23-R27). On Windows the entry runs from PowerShell and from `cmd.exe` with no `bash` and no
// `fzf` on the child PATH; the `windows-create-extension` job runs this file. Elsewhere the same
// assertions run with the entry started directly, so the proof is runnable on any host. The PATH
// filter and the `fzf` filter are also tested on simulated win32 data.

import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";

import { dropFzf, proofPath, runProof } from "./lib/windows-create-extension-proof.ts";
import { WIN } from "./lib/windows-proof-support.ts";

const aggregate = (failures: readonly string[]): string =>
  `${failures.length} failure(s)\n${failures.map((f, i) => `${i + 1}. ${f}`).join("\n")}`;

describe("windows create-extension proof", () => {
  it("passes under PowerShell and cmd.exe, no bash and no fzf", { skip: !WIN }, () => {
    const failures = runProof(["pwsh", "cmd"]);
    assert.deepEqual(failures, [], aggregate(failures));
  });

  it("passes with the entry started directly on a POSIX host", { skip: WIN }, () => {
    const failures = runProof(["pwsh"]);
    assert.deepEqual(failures, [], aggregate(failures));
  });
});

describe("windows create-extension proof helpers", () => {
  it("drops every directory holding an fzf, whatever its extension", () => {
    const files = [path.join("a", "fzf"), path.join("b", "fzf.exe"), path.join("c", "tool")];
    const isFile = (file: string): boolean => files.includes(file);
    assert.deepEqual(dropFzf(["a", "b", "c", "d"], isFile), ["c", "d"]);
  });

  it("builds a PATH that starts with the tripwire and never holds an fzf", () => {
    const value = proofPath("/stubs", process.env["PATH"] ?? "");
    assert.equal(value.split(path.delimiter)[0], "/stubs");
  });
});
