// Contract of the ten model/CI forwarding shims (spec 0262 requirement 16): each scripts/<name>.sh
// forwards arguments, stdin and the exit status to its TypeScript twin, and fails closed without node.
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const SCRIPTS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const NAMES = [
  "check-model-mappings",
  "check-agent-profiles",
  "check-ci-parity",
  "check-spec-id-reserved",
  "build-ci",
  "ci-cache-guard",
  "ci-changeset-coverage",
  "reserve-spec-id",
  "merge-spec-pr",
  "sweep-en-us",
];

function which(cmd: string): string | undefined {
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    const candidate = path.join(dir, cmd);
    if (dir && existsSync(candidate)) return candidate;
  }
  return undefined;
}

const bash = process.platform === "win32" ? undefined : which("bash");
const skipAll = process.platform === "win32";
if (!skipAll && !bash && process.env.CI) {
  assert.fail("bash is required on non-win32 CI runners to exercise the model/CI shims");
}
const skip = skipAll ? "shims are POSIX files" : !bash ? "bash not found" : false;

const work = mkdtempSync(path.join(tmpdir(), "model-ci-shims-"));
after(() => rmSync(work, { recursive: true, force: true }));

// Binaries the shim needs besides bash builtins (command, cd, pwd, echo, exit, exec): dirname.
const HERMETIC_TOOLS = ["bash", "dirname"];

describe("model/CI forwarding shims", { skip }, () => {
  test("every name has a shim that mentions its .ts twin", () => {
    for (const name of NAMES) {
      const file = path.join(SCRIPTS, `${name}.sh`);
      assert.ok(existsSync(file), `${file} exists`);
      const text = readFileSync(file, "utf8");
      assert.ok(text.includes(`${name}.ts`), `${name}: shim names its .ts twin`);
      assert.ok(existsSync(path.join(SCRIPTS, `${name}.ts`)), `${name}: .ts twin exists`);
    }
  });

  test("forwards arguments, stdin and the exit status of the entry", () => {
    for (const name of NAMES) {
      const dir = path.join(work, `fwd-${name}`);
      mkdirSync(path.join(dir, "lib"), { recursive: true });
      copyFileSync(path.join(SCRIPTS, `${name}.sh`), path.join(dir, `${name}.sh`));
      copyFileSync(
        path.join(SCRIPTS, "lib", "node-floor-guard.js"),
        path.join(dir, "lib", "node-floor-guard.js"),
      );
      writeFileSync(
        path.join(dir, `${name}.ts`),
        [
          'import { readFileSync } from "node:fs";',
          'const stdin = readFileSync(0, "utf8");',
          "process.stdout.write(JSON.stringify({ argv: process.argv.slice(2), stdin }));",
          "process.exit(7);",
          "",
        ].join("\n"),
      );
      const r = spawnSync(bash as string, [path.join(dir, `${name}.sh`), "--flag", "a b", ""], {
        input: "hello\nworld\n",
        encoding: "utf8",
      });
      assert.equal(r.status, 7, `${name}: exit status forwarded (stderr: ${r.stderr})`);
      assert.deepEqual(
        JSON.parse(r.stdout),
        { argv: ["--flag", "a b", ""], stdin: "hello\nworld\n" },
        `${name}: argv and stdin forwarded`,
      );
    }
  });

  test("fails closed with one Error: line and exit 1 when node is not on PATH", () => {
    const bin = path.join(work, "bin");
    mkdirSync(bin);
    for (const tool of HERMETIC_TOOLS) {
      const real = which(tool);
      assert.ok(real, `${tool} is available on the host`);
      symlinkSync(real as string, path.join(bin, tool));
    }
    for (const name of NAMES) {
      const r = spawnSync(bash as string, [path.join(SCRIPTS, `${name}.sh`)], {
        encoding: "utf8",
        env: { PATH: bin },
      });
      assert.equal(r.status, 1, `${name}: exit 1 (stderr: ${r.stderr})`);
      assert.equal(r.stdout, "", `${name}: no stdout`);
      const lines = r.stderr.split("\n").filter((l) => l !== "");
      assert.equal(
        lines.length,
        1,
        `${name}: exactly one stderr line, got ${JSON.stringify(r.stderr)}`,
      );
      assert.match(lines[0], /^Error: /, `${name}: Error: prefix`);
    }
  });
});
