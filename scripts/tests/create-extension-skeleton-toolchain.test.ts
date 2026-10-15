// create-extension-skeleton-toolchain.test.ts — the scaffold carries the repository's own TypeScript
// toolchain pins (spec 0258 R26): `typescript` at the root's version, `@types/node` at the root's range.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

const REPO = path.resolve(import.meta.dirname, "..", "..");

function devDependencies(file: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(fs.readFileSync(path.join(REPO, file), "utf8"));
  const deps: unknown =
    typeof parsed === "object" && parsed !== null ? Reflect.get(parsed, "devDependencies") : null;
  assert.ok(typeof deps === "object" && deps !== null, `${file} has devDependencies`);
  return deps as Record<string, unknown>;
}

test("the skeleton pins typescript and @types/node as the repository root does", () => {
  const root = devDependencies("package.json");
  const skeleton = devDependencies("extension-skeleton/base/package.json");
  assert.match(String(root["typescript"]), /^7\./);
  assert.equal(skeleton["typescript"], root["typescript"]);
  assert.equal(skeleton["@types/node"], root["@types/node"]);
});

test("the skeleton tsconfig declares the node types (TypeScript 7 includes no @types implicitly)", () => {
  const parsed: unknown = JSON.parse(
    fs.readFileSync(path.join(REPO, "extension-skeleton/base/tsconfig.json"), "utf8"),
  );
  const options: unknown =
    typeof parsed === "object" && parsed !== null ? Reflect.get(parsed, "compilerOptions") : null;
  const types: unknown =
    typeof options === "object" && options !== null ? Reflect.get(options, "types") : null;
  assert.ok(Array.isArray(types) && types.includes("node"), "compilerOptions.types lists node");
});

const BIN = (tool: string): string =>
  path.join(REPO, "node_modules", ".bin", process.platform === "win32" ? `${tool}.cmd` : tool);
const TSC = BIN("tsc");
const SDK = path.join(REPO, "node_modules", "@modelcontextprotocol", "sdk");
const NODE_TYPES = path.join(REPO, "node_modules", "@types", "node");

/** One tool the proof needs: what it is called in a message and where it must be installed. */
interface Need {
  readonly label: string;
  readonly file: string;
}

/** The first needed tool that is not installed, as a message, or `false` when all are present. */
export function firstMissing(
  needs: readonly Need[],
  exists: (file: string) => boolean,
): string | false {
  const gap = needs.find((need) => !exists(need.file));
  return gap === undefined ? false : `the root's ${gap.label} is not installed`;
}

/** `CI` is set on GitHub Actions and GitLab (`true`); an empty value, `0` and `false` mean it is not. */
export function inCi(env: NodeJS.ProcessEnv): boolean {
  const value = (env["CI"] ?? "").trim().toLowerCase();
  return value !== "" && value !== "0" && value !== "false";
}

/**
 * What a test that needs the dev toolchain does. A missing tool is a skip for a local run and a FAILURE
 * under CI: the job is meant to install the toolchain, so a skip there would leave requirement 26
 * unproven while the run stays green.
 */
export function toolchainDecision(
  missing: string | false,
  env: NodeJS.ProcessEnv,
): { readonly skip: string | false; readonly fault: string | false } {
  if (missing === false) return { skip: false, fault: false };
  return inCi(env) ? { skip: false, fault: missing } : { skip: missing, fault: false };
}

const COMPILE_NEEDS: readonly Need[] = [
  { label: "tsc", file: TSC },
  { label: "@modelcontextprotocol/sdk", file: SDK },
  { label: "@types/node", file: NODE_TYPES },
];
const GATES_NEEDS: readonly Need[] = [
  { label: "tsc", file: TSC },
  { label: "oxlint", file: BIN("oxlint") },
  { label: "oxfmt", file: BIN("oxfmt") },
  { label: "@modelcontextprotocol/sdk", file: SDK },
  { label: "@types/node", file: NODE_TYPES },
];
const COMPILE = toolchainDecision(firstMissing(COMPILE_NEEDS, fs.existsSync), process.env);
const GATES = toolchainDecision(firstMissing(GATES_NEEDS, fs.existsSync), process.env);

test("the scaffold toolchain is installed when CI is set (a missing tool fails there, it never skips)", () => {
  assert.equal(COMPILE.fault, false, String(COMPILE.fault));
  assert.equal(GATES.fault, false, String(GATES.fault));
});

test("a missing tool fails under CI and skips locally (the decision, with an injected environment)", () => {
  const present = (): boolean => true;
  const absent = (): boolean => false;
  assert.equal(firstMissing(GATES_NEEDS, present), false);
  const gap = firstMissing(GATES_NEEDS, absent);
  assert.equal(gap, "the root's tsc is not installed");
  assert.deepEqual(toolchainDecision(false, { CI: "true" }), { skip: false, fault: false });
  assert.deepEqual(toolchainDecision(gap, { CI: "true" }), { skip: false, fault: gap });
  assert.deepEqual(toolchainDecision(gap, { CI: "1" }), { skip: false, fault: gap });
  for (const local of [{}, { CI: "" }, { CI: "0" }, { CI: "false" }])
    assert.deepEqual(
      toolchainDecision(gap, local),
      { skip: gap, fault: false },
      JSON.stringify(local),
    );
  assert.equal(
    firstMissing(COMPILE_NEEDS, (file) => file !== SDK),
    "the root's @modelcontextprotocol/sdk is not installed",
  );
});

test(
  "a scaffold with the mcp-server component type-checks with the root tsc",
  {
    skip: COMPILE.skip,
  },
  () => {
    const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "skeleton-tsc-")));
    try {
      fs.copyFileSync(
        path.join(REPO, "extension-skeleton/base/tsconfig.json"),
        path.join(dir, "tsconfig.json"),
      );
      fs.cpSync(path.join(REPO, "extension-skeleton/mcp-server/src"), path.join(dir, "src"), {
        recursive: true,
      });
      const modules = path.join(dir, "node_modules");
      fs.mkdirSync(path.join(modules, "@types"), { recursive: true });
      fs.mkdirSync(path.join(modules, "@modelcontextprotocol"), { recursive: true });
      fs.symlinkSync(NODE_TYPES, path.join(modules, "@types", "node"), "junction");
      fs.symlinkSync(SDK, path.join(modules, "@modelcontextprotocol", "sdk"), "junction");
      const res = spawnSync(TSC, ["--noEmit", "-p", "tsconfig.json"], {
        cwd: dir,
        encoding: "utf8",
        shell: process.platform === "win32",
      });
      assert.equal(res.status, 0, `${res.stdout}${res.stderr}`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
);

// The scaffold must format the same way whatever the length of the extension name: the shortest name
// the scaffolder accepts and a name far past 100 columns are both gated, so a skeleton line that the
// formatter reflows with the name (a call collapsing onto one line for a short name, or breaking
// across lines for a long one) cannot come back unnoticed.
const SCAFFOLD_NAMES = ["x", `scaffold-gates-every-component-${"long-".repeat(24)}end`];
const EVERY_COMPONENT = "mcp-server,command,skill,agent,hook,theme";

function sh(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = {}) {
  const res = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, BASE_REF: "", ...env },
  });
  return { status: res.status, output: `${res.stdout}${res.stderr}` };
}

for (const SCAFFOLD_NAME of SCAFFOLD_NAMES) {
  test(
    `a scaffold named ${SCAFFOLD_NAME.length > 40 ? `<${SCAFFOLD_NAME.length} characters>` : SCAFFOLD_NAME} with every component under extensions/org/ passes check-typescript --step all and the ratchet`,
    { skip: GATES.skip, timeout: 600_000 },
    () => {
      // A copy of the whole tracked tree: the root tsconfig.json, .oxlintrc.json, .oxfmtrc.json and the
      // ratchet lists apply to the scaffold by inheritance, exactly as they do inside the repository.
      const list = spawnSync("git", ["ls-files", "-z"], { cwd: REPO, encoding: "buffer" });
      assert.equal(list.status, 0, "git ls-files");
      const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "skeleton-gates-")));
      try {
        for (const rel of list.stdout.toString("utf8").split("\0")) {
          if (rel === "") continue;
          const from = path.join(REPO, rel);
          const stat = fs.lstatSync(from, { throwIfNoEntry: false });
          if (stat === undefined) continue;
          fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
          if (stat.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(from), path.join(dir, rel));
          else fs.copyFileSync(from, path.join(dir, rel));
        }
        assert.equal(sh("git", ["init", "--quiet"], dir).status, 0, "git init");
        // The scaffolder's render step loads js-yaml from real files (never a link).
        for (const name of ["js-yaml", "argparse"])
          fs.cpSync(path.join(REPO, "node_modules", name), path.join(dir, "node_modules", name), {
            recursive: true,
            dereference: true,
          });
        fs.mkdirSync(path.join(dir, "extensions", "org"), { recursive: true });
        const made = sh(
          process.execPath,
          ["scripts/create-extension.ts", "--components", EVERY_COMPONENT],
          dir,
          { NAME: SCAFFOLD_NAME, TIER: "org", HOME: path.join(dir, ".home") },
        );
        assert.equal(made.status, 0, made.output);
        const scaffold = path.join(dir, "extensions", "org", SCAFFOLD_NAME);
        assert.ok(fs.existsSync(path.join(scaffold, "extension.json")), "the scaffold exists");
        for (const inherited of [".oxlintrc.json", ".oxfmtrc.json"])
          assert.ok(!fs.existsSync(path.join(scaffold, inherited)), `${inherited} is inherited`);
        // The skeleton's own tsconfig.json builds the extension standalone; it is not the root's file.
        assert.notEqual(
          fs.readFileSync(path.join(scaffold, "tsconfig.json"), "utf8"),
          fs.readFileSync(path.join(REPO, "tsconfig.json"), "utf8"),
        );
        // Link the root's tools only now, so the render step above ran on real copies.
        fs.rmSync(path.join(dir, "node_modules"), { recursive: true, force: true });
        fs.symlinkSync(path.join(REPO, "node_modules"), path.join(dir, "node_modules"), "junction");
        assert.equal(sh("git", ["add", "-A", "--", "."], dir).status, 0, "git add");
        const gates = sh(
          process.execPath,
          [
            "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
            "scripts/check-typescript.ts",
            "--step",
            "all",
          ],
          dir,
        );
        assert.equal(gates.status, 0, gates.output);
        const ratchet = sh(
          process.execPath,
          ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "scripts/check-ratchet.ts"],
          dir,
        );
        assert.equal(ratchet.status, 0, ratchet.output);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  );
}
