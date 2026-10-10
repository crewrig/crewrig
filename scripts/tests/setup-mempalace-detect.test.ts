// setup-mempalace-detect.test.ts — detectMempalaceInterpreter and installedVersion
// (scripts/lib/setup/mempalace-detect.ts) over a fake detector and a fake Spawner.

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SpawnOptions, SpawnResult, Spawner } from "../lib/setup/context.ts";
import {
  VERSION_PROGRAM,
  detectMempalaceInterpreter,
  installedVersion,
} from "../lib/setup/mempalace-detect.ts";

interface Call {
  readonly argv: readonly string[];
  readonly options: SpawnOptions | undefined;
}

function fakeSpawn(result: Partial<SpawnResult>): { spawn: Spawner; calls: Call[] } {
  const calls: Call[] = [];
  const spawn: Spawner = (argv, options) => {
    calls.push({ argv, options });
    return { status: 0, stdout: "", stderr: "", ...result };
  };
  return { spawn, calls };
}

describe("detectMempalaceInterpreter", () => {
  it("returns the interpreter the detector found, handing it the context environment", () => {
    let seen: NodeJS.ProcessEnv | undefined;
    const found = detectMempalaceInterpreter(
      { env: { PATH: "/x", HOME: "/h" } },
      {
        detect: (env) => ((seen = env), "/h/.local/pipx/venvs/mempalace/bin/python"),
      },
    );
    assert.equal(found, "/h/.local/pipx/venvs/mempalace/bin/python");
    assert.deepEqual(seen, { PATH: "/x", HOME: "/h" });
  });

  it("keeps the Windows launcher as listed, for installedVersion to split", () => {
    assert.equal(detectMempalaceInterpreter({ env: {} }, { detect: () => "py -3" }), "py -3");
  });

  it("returns undefined when no candidate imports mempalace", () => {
    assert.equal(detectMempalaceInterpreter({ env: {} }, { detect: () => undefined }), undefined);
    assert.equal(detectMempalaceInterpreter({ env: {} }, { detect: () => "" }), undefined);
  });
});

describe("installedVersion", () => {
  it("runs the interpreter with the importlib.metadata program and strips the line break", () => {
    const { spawn, calls } = fakeSpawn({ stdout: "3.6.2\n" });
    assert.equal(installedVersion(spawn, "/venv/bin/python"), "3.6.2");
    assert.deepEqual(calls, [
      { argv: ["/venv/bin/python", "-c", VERSION_PROGRAM], options: undefined },
    ]);
    assert.equal(
      VERSION_PROGRAM,
      "from importlib.metadata import version; print(version('mempalace'))",
    );
  });

  it("strips a Windows CRLF", () => {
    assert.equal(installedVersion(fakeSpawn({ stdout: "3.6.2\r\n" }).spawn, "python"), "3.6.2");
  });

  it("splits the py -3 launcher into command and leading argument", () => {
    const { spawn, calls } = fakeSpawn({ stdout: "3.6.0\n" });
    assert.equal(installedVersion(spawn, "py -3"), "3.6.0");
    assert.deepEqual(calls[0]?.argv, ["py", "-3", "-c", VERSION_PROGRAM]);
  });

  it("does not split an interpreter path that contains a space", () => {
    const { spawn, calls } = fakeSpawn({ stdout: "3.6.0\n" });
    installedVersion(spawn, "/Users/a b/pipx/venvs/mempalace/bin/python");
    assert.deepEqual(calls[0]?.argv, [
      "/Users/a b/pipx/venvs/mempalace/bin/python",
      "-c",
      VERSION_PROGRAM,
    ]);
  });

  it("returns undefined for an empty output, a failed run and a missing interpreter", () => {
    assert.equal(installedVersion(fakeSpawn({ stdout: "\n" }).spawn, "python3"), undefined);
    assert.equal(installedVersion(fakeSpawn({ stdout: "" }).spawn, "python3"), undefined);
    assert.equal(
      installedVersion(fakeSpawn({ status: 1, stdout: "", stderr: "Traceback" }).spawn, "python3"),
      undefined,
    );
    assert.equal(
      installedVersion(fakeSpawn({ status: 127, stdout: "3.6.0\n" }).spawn, "python3"),
      undefined,
    );
  });

  it("never reproduces stderr, whatever the status", () => {
    const { spawn } = fakeSpawn({ stdout: "3.6.0\n", stderr: "warning: noisy" });
    assert.equal(installedVersion(spawn, "python3"), "3.6.0");
  });
});
