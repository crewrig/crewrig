// service-bundle-closure.test.ts — the import closure of the two installed
// programs (spec 0252 requirement 10 with delta-01; plan v3 steps 12): every
// static import of both entries and of every bundled file resolves inside the
// bundle, the bundle lists hold no file no entry imports, and both installed
// programs run with the checkout gone.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  LAUNCHER_BUNDLE,
  SERVICE_LIB_FILES,
  TRUST_WRAPPER_BUNDLE,
  flatName,
} from "../lib/service/launcher/bundle.ts";
import {
  LAUNCHER_ENTRY,
  REPO_LIB_DIR,
  WRAPPER_ENTRY,
  installLauncherProgram,
  installTrustWrapperProgram,
  installedPaths,
} from "../lib/service/program-install.ts";

const STATIC_IMPORT_RE =
  /(?:^|\n)\s*(?:import|export)\b[^;"']*?\bfrom\s*"([^"]+)"|(?:^|\n)\s*import\s*"([^"]+)"/g;

/** Every static specifier of a source text. */
export function specifiers(source: string): string[] {
  return [...source.matchAll(STATIC_IMPORT_RE)].map((m) => (m[1] ?? m[2]) as string);
}

/** Repository-relative closure of an entry; every non-relative specifier must be `node:`. */
function closure(entry: string): Set<string> {
  const seen = new Set<string>();
  const walk = (file: string): void => {
    for (const spec of specifiers(readFileSync(path.join(REPO_LIB_DIR, file), "utf8"))) {
      if (!spec.startsWith(".")) {
        assert.ok(spec.startsWith("node:"), `${file} imports non-node module ${spec}`);
        continue;
      }
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), spec));
      if (!seen.has(target)) {
        seen.add(target);
        walk(target);
      }
    }
  };
  walk(entry);
  return seen;
}

test("each bundle list is exactly the import closure of its entry", () => {
  assert.deepEqual([...closure(LAUNCHER_ENTRY)].sort(), [...LAUNCHER_BUNDLE].sort());
  assert.deepEqual([...closure(WRAPPER_ENTRY)].sort(), [...TRUST_WRAPPER_BUNDLE].sort());
});

test("the launcher's closure does not include the trust wrapper", () => {
  assert.equal(closure(LAUNCHER_ENTRY).has(WRAPPER_ENTRY), false);
  assert.equal(SERVICE_LIB_FILES.includes(WRAPPER_ENTRY), false);
});

test("flat names are unique and bundled files import each other only as ./name.ts", () => {
  const flats = SERVICE_LIB_FILES.map(flatName);
  assert.equal(new Set(flats).size, flats.length);
  for (const file of SERVICE_LIB_FILES) {
    for (const spec of specifiers(readFileSync(path.join(REPO_LIB_DIR, file), "utf8"))) {
      if (spec.startsWith("node:")) continue;
      assert.match(spec, /^\.\/[^/]+\.ts$/, `${file} imports ${spec}`);
      assert.ok(flats.includes(spec.slice(2)), `${file} imports ${spec}, not in the bundle`);
    }
  }
});

function installBoth(home: string, lib?: string) {
  const paths = installedPaths(home, {});
  const base = {
    paths,
    ...(lib === undefined ? {} : { libDir: lib }),
  };
  installLauncherProgram({
    ...base,
    repoDir: path.join(home, "no-checkout"),
    host: "127.0.0.1",
    port: "41893",
    chromaHost: "127.0.0.1",
    chromaPort: "8001",
    python: "/nonexistent/python",
    palacePath: "",
  });
  installTrustWrapperProgram(base);
  return paths;
}

test("in an install, every import of both entries and of every bundled file resolves inside service-lib", () => {
  const home = mkdtempSync(path.join(tmpdir(), "closure-"));
  const paths = installBoth(home);
  const lib = path.join(path.dirname(paths.launcher), "service-lib");
  const check = (file: string, prefix: string): void => {
    for (const spec of specifiers(readFileSync(file, "utf8"))) {
      if (spec.startsWith("node:")) continue;
      assert.ok(spec.startsWith(prefix), `${file} imports ${spec}`);
      assert.ok(
        existsSync(path.join(lib, path.basename(spec))),
        `${spec} missing from service-lib`,
      );
    }
  };
  check(paths.launcher, "./service-lib/");
  check(paths.wrapper, "./service-lib/");
  for (const file of SERVICE_LIB_FILES) check(path.join(lib, flatName(file)), "./");
  rmSync(home, { recursive: true });
});

test(
  "both installed programs run with the checkout gone",
  { skip: process.platform === "win32" },
  () => {
    const home = mkdtempSync(path.join(tmpdir(), "closure-run-"));
    // A copy tree stands for the checkout; it is deleted after the install.
    const checkout = path.join(home, "checkout", "scripts", "lib");
    cpSync(REPO_LIB_DIR, checkout, { recursive: true });
    const paths = installBoth(home, checkout);
    rmSync(path.join(home, "checkout"), { recursive: true });
    const cwd = mkdtempSync(path.join(tmpdir(), "closure-cwd-"));
    const env = {
      PATH: process.env["PATH"] ?? "",
      HOME: home,
      USERPROFILE: home,
      MEMPALACE_MCP_TOKEN_FILE: path.join(home, "absent-token"),
    };
    const flags = ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON"];

    const launcher = spawnSync(process.execPath, [...flags, paths.launcher], {
      cwd,
      env,
      encoding: "utf8",
    });
    assert.notEqual(launcher.status, 0);
    assert.match(launcher.stderr, /token/i, launcher.stderr);
    assert.doesNotMatch(launcher.stderr, /ERR_MODULE_NOT_FOUND|Cannot find module/);

    const marker = "closure-ran";
    const wrapper = spawnSync(
      process.execPath,
      [...flags, paths.wrapper, process.execPath, "-e", `console.log("${marker}")`],
      { cwd, env, encoding: "utf8" },
    );
    assert.equal(wrapper.status, 0, wrapper.stderr);
    assert.match(wrapper.stdout, new RegExp(marker));
    rmSync(home, { recursive: true });
    rmSync(cwd, { recursive: true });
  },
);
