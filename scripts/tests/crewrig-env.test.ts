// crewrig-env.test.ts — the environment of `build`, `setup` and `update` (spec 0315 R12; delta-01 R12, R14; plan
// v3-F1, v3-F2). env.ts strips three classes of variables and passes the closed allowlist of six; the oracle
// (lib/env-classes.ts) is written from the spec, so a strip that drifts in either direction fails here.
//
// Out-of-process `setup` runs never reach the writers of the six allowlisted values (a PATH without a MemPalace
// interpreter keeps them off the daemon path), so the six are proven by probes that import env.ts first and then run
// the code `setup` runs (lib/env-probe.ts). The end-to-end legs, with the launcher, are in
// crewrig-env-isolation.test.ts.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import { isStrippedVariable, stripEnvironment } from "../lib/crewrig-cli/env.ts";
import {
  ALLOWLIST,
  LAUNCHER_VARIABLE,
  STRIPPED_NAMES,
  UNAFFECTED_NAMES,
  classifyEnvName,
} from "./lib/env-classes.ts";
import { dumpEnv, installProbe } from "./lib/env-probe.ts";
import { REPO, trackRigs } from "./lib/launcher-rig.ts";

const rigs = trackRigs();

const SIX = (palace: string): Record<string, string> => ({
  MEMPALACE_MCP_HOST: "127.0.0.2",
  MEMPALACE_MCP_PORT: "8765",
  MEMPALACE_CHROMA_HOST: "127.0.0.3",
  MEMPALACE_CHROMA_PORT: "8011",
  MEMPALACE_PALACE_PATH: palace,
  MEMPALACE_PYTHON: path.join(palace, "stub-python"),
});

/**
 * The value of a variable by name. On win32 the environment is case-insensitive: the system's PATH is Path, and the
 * child reports it under that spelling, so the lookup matches names without regard to case there.
 */
const valueNamed = (env: Record<string, string | undefined>, name: string): string | undefined => {
  if (process.platform !== "win32") return env[name];
  const key = Object.keys(env).find((candidate) => candidate.toUpperCase() === name.toUpperCase());
  return key === undefined ? undefined : env[key];
};

/** Every stripped name, set to a value inside the rig's root, so a strip that fails writes nowhere else. */
const stripped = (root: string): Record<string, string> =>
  Object.fromEntries(STRIPPED_NAMES.map((name) => [name, path.join(root, `value-of-${name}`)]));

describe("delta-01 R12: exactly the six allowlisted values and the launcher variable survive", () => {
  test("a process that imported env.ts holds the six, the launcher variable and everything unrelated, and no other name of the classes", () => {
    const rig = rigs.make();
    const six = SIX(path.join(rig.root, "palace"));
    const unaffected = {
      NODE_EXTRA_CA_CERTS: "/etc/ssl/corp.pem",
      SSL_CERT_FILE: "/etc/ssl/cert.pem",
      REPO_DIR: "/somewhere/generic",
      MCP_SOMETHING_ELSE: "kept",
    };

    const probe = dumpEnv(rig, {
      ...stripped(rig.root),
      ...six,
      ...unaffected,
      [LAUNCHER_VARIABLE]: "http://127.0.0.1:9",
    });

    assert.equal(probe.status, 0, probe.stderr);
    const env = probe.data ?? {};
    for (const [name, value] of Object.entries(six)) assert.equal(env[name], value, name);
    assert.equal(env[LAUNCHER_VARIABLE], "http://127.0.0.1:9");
    for (const [name, value] of Object.entries(unaffected)) assert.equal(env[name], value, name);
    for (const name of ["HOME", "USERPROFILE", "PATH"]) {
      assert.ok(valueNamed(env, name) !== undefined, name);
    }
    for (const name of STRIPPED_NAMES) {
      assert.equal(valueNamed(env, name), undefined, `${name} survived`);
    }
    const ofClasses = Object.keys(env).filter((name) =>
      /^(crewrig_|mempalace_|mcp_daemon_)/i.test(name),
    );
    assert.deepEqual(
      ofClasses.sort(),
      [...ALLOWLIST, LAUNCHER_VARIABLE].sort(),
      "only the six and the launcher variable remain of the classes",
    );
  });

  test("the strip function agrees with the oracle on every name of the spec's table and on the names it leaves alone", () => {
    for (const name of STRIPPED_NAMES) {
      assert.equal(isStrippedVariable(name), true, name);
      assert.equal(classifyEnvName(name), "stripped", name);
    }
    for (const name of [...ALLOWLIST, LAUNCHER_VARIABLE, ...UNAFFECTED_NAMES]) {
      assert.equal(isStrippedVariable(name), false, name);
    }
  });

  test("stripEnvironment removes from the object it is given, returns the names removed, and leaves the rest", () => {
    const env: NodeJS.ProcessEnv = {
      ...stripped("/r"),
      ...SIX("/p"),
      KEEP: "yes",
    };

    const removed = stripEnvironment(env);

    assert.deepEqual(removed.sort(), [...STRIPPED_NAMES].sort());
    assert.deepEqual(Object.keys(env).sort(), [...ALLOWLIST, "KEEP"].sort());
  });

  test("an unset or empty allowlisted variable leaves the default behaviour", () => {
    const rig = rigs.make();

    const probe = installProbe(rig, {
      MEMPALACE_MCP_HOST: "",
      MEMPALACE_MCP_PORT: "",
      MEMPALACE_CHROMA_HOST: "",
      MEMPALACE_CHROMA_PORT: undefined,
      MEMPALACE_PALACE_PATH: "",
      MEMPALACE_PYTHON: "/stub/python",
    });

    assert.equal(probe.status, 0, probe.stderr);
    const report = probe.data;
    assert.equal(report?.ok, true, report?.lines.join("\n"));
    assert.deepEqual(report?.hookEndpoint, { host: "127.0.0.1", port: "41893" });
    assert.deepEqual(report?.chroma, { host: "127.0.0.1", port: "8001" });
    assert.match(report?.launcherText ?? "", /const MCP_HOST: string = "127\.0\.0\.1";/);
    assert.match(report?.launcherText ?? "", /const CHROMA_PORT: string = "8001";/);
  });
});

describe("delta-01 R14: an allowlisted setting reaches what setup writes, and the run-time readers agree", () => {
  test("the daemon launcher setup installs carries the six values, and a hook and the Chroma wrapper resolve the same endpoint", () => {
    const rig = rigs.make();
    const palace = path.join(rig.root, "palace");
    const six = SIX(palace);

    const probe = installProbe(rig, { ...six, ...stripped(rig.root) });

    assert.equal(probe.status, 0, probe.stderr);
    const report = probe.data;
    assert.equal(report?.ok, true, report?.lines.join("\n"));
    const text = report?.launcherText ?? "";
    const constant = (name: string): string | undefined =>
      new RegExp(`const ${name}: string = (".*");`).exec(text)?.[1];
    assert.equal(constant("MCP_HOST"), JSON.stringify("127.0.0.2"));
    assert.equal(constant("MCP_PORT"), JSON.stringify("8765"));
    assert.equal(constant("CHROMA_HOST"), JSON.stringify("127.0.0.3"));
    assert.equal(constant("CHROMA_PORT"), JSON.stringify("8011"));
    assert.equal(constant("MEMPALACE_PYTHON"), JSON.stringify(six.MEMPALACE_PYTHON));
    assert.equal(constant("CONFIGURED_PALACE_PATH"), JSON.stringify(palace));
    // The endpoint a hook resolves (the shared client reads the environment itself) equals the one recorded.
    assert.deepEqual(report?.hookEndpoint, { host: "127.0.0.2", port: "8765" });
    assert.deepEqual(report?.chroma, { host: "127.0.0.3", port: "8011" });
    const defaults = installProbe(rig, { MEMPALACE_PYTHON: "/stub/python" }).data;
    assert.notEqual(
      report?.tokenPath,
      defaults?.tokenPath,
      "the hook's token lookup follows the palace path",
    );
  });

  test("the Chroma wrapper resolves the host and port that the launcher recorded", (t) => {
    const rig = rigs.make();
    const six = SIX(path.join(rig.root, "palace"));
    const python = ["python3", "python"].find(
      (candidate) => spawnSync(candidate, ["--version"], { stdio: "ignore" }).status === 0,
    );
    if (python === undefined) {
      t.skip("neither `python3 --version` nor `python --version` answers on this runner");
      return;
    }
    const wrapper = path.join(REPO, "scripts", "lib", "mempalace-http-wrapper.py");
    // The two assignments of the wrapper itself, run as they are in the file (not a copy of them).
    const script = [
      "import os, re, json",
      `src = open(${JSON.stringify(wrapper)}, encoding="utf-8").read()`,
      'lines = [l for l in src.splitlines() if re.match(r"^_(host|port) = ", l)]',
      "ns = {'os': os}",
      "exec('\\n'.join(lines), ns)",
      "print(json.dumps({'host': ns['_host'], 'port': str(ns['_port'])}))",
    ].join("\n");

    const run = spawnSync(python, ["-I", "-c", script], {
      env: { ...rig.env(), ...six },
      encoding: "utf8",
    });
    const probe = installProbe(rig, six);

    assert.equal(run.status, 0, run.stderr);
    assert.deepEqual(JSON.parse(run.stdout), probe.data?.chroma);
    assert.deepEqual(JSON.parse(run.stdout), { host: "127.0.0.3", port: "8011" });
  });
});

describe("delta-01 R12: test seams have no effect", () => {
  test("MEMPALACE_MCP_EVICT_CMD never fires: the marker does not appear, and the variable is gone from the process", () => {
    const rig = rigs.make();
    const marker = path.join(rig.root, "evicted");
    const command = `${JSON.stringify(process.execPath)} -e "require('fs').writeFileSync(${JSON.stringify(marker)}, 'x')"`;

    const probe = installProbe(rig, {
      MEMPALACE_MCP_EVICT_CMD: command,
      MEMPALACE_MCP_EXPECTED_PID: "1",
      MEMPALACE_MCP_LISTENER_PID: "2",
      MCP_DAEMON_REPLACE_DEADLINE: "1",
      MEMPALACE_PYTHON: "/stub/python",
    });
    const env = dumpEnv(rig, { MEMPALACE_MCP_EVICT_CMD: command });

    assert.equal(probe.status, 0, probe.stderr);
    assert.ok(!fs.existsSync(marker), "the evict command ran");
    assert.equal(env.data?.["MEMPALACE_MCP_EVICT_CMD"], undefined);
  });

  test("the daemon label and unit stay the defaults whatever MEMPALACE_MCP_LABEL and MEMPALACE_MCP_UNIT say", () => {
    const rig = rigs.make();

    const probe = installProbe(rig, {
      MEMPALACE_MCP_LABEL: "com.example.custom",
      MEMPALACE_MCP_UNIT: "custom-unit",
      MEMPALACE_PYTHON: "/stub/python",
    });

    assert.equal(probe.status, 0, probe.stderr);
    const written = (probe.data?.lines ?? []).join("\n");
    assert.doesNotMatch(written, /custom/);
    assert.match(written, /com\.mempalace\.mcp-server|mempalace-mcp-server/);
  });
});
