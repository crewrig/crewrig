// framework-release-vendor.test.ts — staging js-yaml in the build output (spec 0315 plan step 6; v2-F2, v2-F3, v3-F4).
//
// `build` and `setup` read YAML with the js-yaml that the archive carries under dist/vendor/js-yaml/, so that a
// version root needs no node_modules. The release build stages the installed package: the bytes must be the
// installed ones, a version that differs from package-lock.json fails the build, and two builds that stage at the
// same moment must never publish a torn file (each writes a temporary file whose name is unique to its process).

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import {
  VENDOR_DIR,
  VendorError,
  lockedJsYamlVersion,
  stageJsYaml,
} from "../lib/framework-release/vendor.ts";

const REPO = path.resolve(import.meta.dirname, "..", "..");
const VENDOR_MODULE = pathToFileURL(
  path.join(REPO, "scripts", "lib", "framework-release", "vendor.ts"),
).href;

let root = "";
beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "crewrig-vendor-")));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

interface Package {
  version: string;
  yaml: string;
  license: string;
}

/** A root holding an installed js-yaml and a package-lock.json that pins `locked`. */
function install(pkg: Partial<Package> = {}, locked = pkg.version ?? "4.3.2"): Package {
  const full: Package = {
    version: "4.3.2",
    yaml: "export const load = () => 'one';\n",
    license: "MIT licence text\n",
    ...pkg,
  };
  const dir = path.join(root, "node_modules", "js-yaml");
  fs.mkdirSync(path.join(dir, "dist"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ name: "js-yaml", version: full.version }),
  );
  fs.writeFileSync(path.join(dir, "dist", "js-yaml.mjs"), full.yaml);
  fs.writeFileSync(path.join(dir, "LICENSE"), full.license);
  fs.writeFileSync(
    path.join(root, "package-lock.json"),
    JSON.stringify({ packages: { "node_modules/js-yaml": { version: locked } } }),
  );
  return full;
}

const staged = (name: string): string => path.join(root, VENDOR_DIR, name);

describe("the staged copy is the installed package", () => {
  it("copies js-yaml.mjs and LICENSE byte for byte", () => {
    const pkg = install();

    const written = stageJsYaml(root);

    assert.equal(fs.readFileSync(staged("js-yaml.mjs"), "utf8"), pkg.yaml);
    assert.equal(fs.readFileSync(staged("LICENSE"), "utf8"), pkg.license);
    assert.deepEqual(
      written.sort(),
      [path.join(VENDOR_DIR, "LICENSE"), path.join(VENDOR_DIR, "js-yaml.mjs")].sort(),
    );
  });

  it("stages the real installed js-yaml of this checkout under the version package-lock.json pins", () => {
    const real = path.join(REPO, "node_modules", "js-yaml");
    fs.mkdirSync(path.join(root, "node_modules"), { recursive: true });
    fs.cpSync(real, path.join(root, "node_modules", "js-yaml"), { recursive: true });
    fs.copyFileSync(path.join(REPO, "package-lock.json"), path.join(root, "package-lock.json"));

    stageJsYaml(root);

    assert.deepEqual(
      fs.readFileSync(staged("js-yaml.mjs")),
      fs.readFileSync(path.join(real, "dist", "js-yaml.mjs")),
    );
    assert.equal(lockedJsYamlVersion(root), lockedJsYamlVersion(REPO));
  });

  it("leaves a file whose bytes already match alone: a second staging writes nothing", () => {
    install();
    stageJsYaml(root);
    const before = fs.statSync(staged("js-yaml.mjs")).mtimeMs;

    const written = stageJsYaml(root);

    assert.deepEqual(written, []);
    assert.equal(fs.statSync(staged("js-yaml.mjs")).mtimeMs, before);
  });

  it("replaces a staged file whose bytes differ from the installed ones", () => {
    const pkg = install();
    fs.mkdirSync(path.join(root, VENDOR_DIR), { recursive: true });
    fs.writeFileSync(staged("js-yaml.mjs"), "stale\n");

    const written = stageJsYaml(root);

    assert.ok(written.includes(path.join(VENDOR_DIR, "js-yaml.mjs")));
    assert.equal(fs.readFileSync(staged("js-yaml.mjs"), "utf8"), pkg.yaml);
  });
});

describe("what fails the build", () => {
  it("an installed version that differs from package-lock.json", () => {
    install({ version: "4.3.1" }, "4.3.2");

    assert.throws(
      () => stageJsYaml(root),
      (error: unknown) => {
        assert.ok(error instanceof VendorError);
        assert.match(
          error.message,
          /installed js-yaml 4\.3\.1 differs from package-lock\.json 4\.3\.2; run npm ci/,
        );
        return true;
      },
    );
    assert.ok(!fs.existsSync(path.join(root, VENDOR_DIR, "js-yaml.mjs")), "nothing is staged");
  });

  it("an absent package", () => {
    fs.writeFileSync(
      path.join(root, "package-lock.json"),
      JSON.stringify({ packages: { "node_modules/js-yaml": { version: "4.3.2" } } }),
    );

    assert.throws(() => stageJsYaml(root), /cannot read package\.json/);
  });

  it("a lock that does not pin js-yaml", () => {
    install();
    fs.writeFileSync(path.join(root, "package-lock.json"), JSON.stringify({ packages: {} }));

    assert.throws(() => stageJsYaml(root), /does not pin node_modules\/js-yaml/);
  });

  it("a missing or unreadable lock", () => {
    install();
    fs.rmSync(path.join(root, "package-lock.json"));

    assert.throws(() => stageJsYaml(root), /cannot read package-lock\.json/);
  });

  it("a package without its ESM build", () => {
    install();
    fs.rmSync(path.join(root, "node_modules", "js-yaml", "dist", "js-yaml.mjs"));

    assert.throws(() => stageJsYaml(root), /js-yaml package lacks .*js-yaml\.mjs/);
  });
});

describe("v3-F4: concurrent staging never publishes a torn file", () => {
  // Each child delays every rename by 400 ms and logs the temporary name it renames from, so that all of them are
  // holding a temporary file at once. With one shared temporary name the second child's exclusive create fails.
  const PRELOAD = `import fs from "node:fs";
const rename = fs.renameSync;
fs.renameSync = (from, to) => {
  fs.appendFileSync(process.env.RENAME_LOG, JSON.stringify({ pid: process.pid, from: String(from) }) + "\\n");
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400);
  return rename(from, to);
};
`;
  const STAGE = `import { stageJsYaml } from ${JSON.stringify(VENDOR_MODULE)};
stageJsYaml(process.env.STAGE_ROOT);
`;

  function child(files: { preload: string; stage: string }, log: string): Promise<number | null> {
    return new Promise((resolve, reject) => {
      const run = spawn(
        process.execPath,
        ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "--import", files.preload, files.stage],
        {
          env: { ...process.env, STAGE_ROOT: root, RENAME_LOG: log },
          stdio: ["ignore", "ignore", "pipe"],
        },
      );
      let stderr = "";
      run.stderr.on("data", (chunk: Buffer) => (stderr += String(chunk)));
      run.on("error", reject);
      run.on("close", (code) => {
        if (code !== 0) process.stderr.write(stderr);
        resolve(code);
      });
    });
  }

  it("six simultaneous stagings all succeed, use temporary names unique to their process, and leave the installed bytes", async () => {
    const pkg = install({ yaml: `export const big = ${JSON.stringify("x".repeat(200_000))};\n` });
    const scripts = fs.mkdtempSync(path.join(root, "scripts-"));
    const files = {
      preload: path.join(scripts, "preload.mjs"),
      stage: path.join(scripts, "stage.mjs"),
    };
    fs.writeFileSync(files.preload, PRELOAD);
    fs.writeFileSync(files.stage, STAGE);
    const log = path.join(root, "renames.jsonl");

    const codes = await Promise.all(Array.from({ length: 6 }, () => child(files, log)));

    assert.deepEqual(codes, [0, 0, 0, 0, 0, 0]);
    const renames = fs
      .readFileSync(log, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { pid: number; from: string });
    const jsYamlTemps = renames.filter((r) => path.basename(r.from).startsWith("js-yaml.mjs."));
    assert.ok(jsYamlTemps.length >= 2, `only ${jsYamlTemps.length} staging(s) overlapped`);
    assert.equal(
      new Set(jsYamlTemps.map((r) => r.from)).size,
      jsYamlTemps.length,
      "temporary names are unique",
    );
    for (const r of jsYamlTemps)
      assert.ok(path.basename(r.from).includes(`.${r.pid}.`), `${r.from} names its process`);
    assert.equal(
      fs.readFileSync(staged("js-yaml.mjs"), "utf8"),
      pkg.yaml,
      "the published file is whole",
    );
    assert.deepEqual(
      fs.readdirSync(path.join(root, VENDOR_DIR)).filter((name) => name.endsWith(".tmp")),
      [],
      "no temporary file is left",
    );
  });
});
