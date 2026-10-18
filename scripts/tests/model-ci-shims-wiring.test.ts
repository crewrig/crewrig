// model-ci-shims-wiring.test.ts — every CI job that runs one of the ten model/CI forwarding shims
// (spec 0262 requirement 16), directly, through `ci-cache-guard.sh`, or through a Bash suite that
// runs one, declares Node.js 24 (the shim's floor guard refuses 22) and, when the TypeScript entry
// reads YAML through `js-yaml`, installs the production dependencies before the first call.
//
// The assertions are functions over the PARSED reference and workflows (`js-yaml`, via the suite
// helper), so the mutation tests run the same functions on an in-memory mutated copy. No file is
// edited.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";

import { globToRegExp } from "../lib/glob-engine.ts";
import { REPO } from "./lib/build-fixture-tree.ts";
import { yamlLib } from "./lib/yaml-lib.ts";

const SHIMS = [
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
// Shims whose TypeScript entry loads `js-yaml` (through the yq-accessors reader or the mapping loader).
const NEEDS_DEPS = [
  "check-model-mappings",
  "check-agent-profiles",
  "check-ci-parity",
  "build-ci",
  "ci-changeset-coverage",
];
const SHIM_RE = new RegExp(`scripts/(${SHIMS.join("|")})\\.sh`, "g");
// A TypeScript test names a shim when its text spawns or mentions `<name>.sh`.
const NAMED_RE = new RegExp(`\\b(${SHIMS.join("|")})\\.sh\\b`, "g");
const PROD_INSTALL = /^npm ci( --omit=dev( --workspaces=false)?)?$/;

/** The shims one command line runs: named in it, or named by a script it runs (one level). */
function shimsRun(command: string): Set<string> {
  const found = new Set<string>();
  const scan = (text: string): void => {
    for (const m of text.matchAll(SHIM_RE)) found.add(m[1] as string);
  };
  scan(command);
  for (const m of command.matchAll(/scripts\/[\w/.-]+\.sh/g)) {
    const file = path.join(REPO, m[0]);
    if (/ci-cache-guard\.sh$/.test(m[0]) || !fs.existsSync(file)) continue;
    scan(fs.readFileSync(file, "utf8"));
  }
  // `node --test <files|globs>`: every test file that names a shim makes the command shim-running.
  if (/--test\b/.test(command)) {
    const tests = fs
      .readdirSync(path.join(REPO, "scripts", "tests"))
      .map((f) => `scripts/tests/${f}`);
    for (const tok of command.split(/\s+/).map((t) => t.replace(/^['"]|['"]$/g, ""))) {
      if (!/^scripts\/tests\/.*\.test\.ts$/.test(tok)) continue;
      const re = globToRegExp(tok);
      for (const f of tests.filter((t) => re.test(t))) {
        for (const m of fs.readFileSync(path.join(REPO, f), "utf8").matchAll(NAMED_RE)) {
          found.add(m[1] as string);
        }
      }
    }
  }
  return found;
}

const needsDeps = (shims: Iterable<string>): boolean =>
  [...shims].some((s) => NEEDS_DEPS.includes(s));

const load = (file: string): unknown =>
  yamlLib.load(fs.readFileSync(path.join(REPO, file), "utf8"));

interface Capability {
  readonly id: string;
  readonly requires?: { readonly runtime?: string | readonly string[] };
  readonly command?: readonly string[];
}

/** Faults of the capability reference: Node.js 24 and the production install before the first shim. */
function capabilityFaults(caps: readonly Capability[]): string[] {
  const faults: string[] = [];
  for (const cap of caps) {
    const commands = (cap.command ?? []).map(String);
    const runs = commands.map(shimsRun);
    const first = runs.findIndex((s) => s.size > 0);
    if (first < 0) continue;
    const runtimes = [cap.requires?.runtime ?? []].flat();
    if (!runtimes.includes("node@24")) faults.push(`${cap.id}: runs a shim without node@24`);
    if (!needsDeps(runs.flatMap((s) => [...s]))) continue;
    const install = commands.findIndex((c) => PROD_INSTALL.test(c));
    if (install < 0) faults.push(`${cap.id}: no production install command`);
    else if (install > first) faults.push(`${cap.id}: install runs after the first shim`);
  }
  return faults;
}

interface Step {
  readonly uses?: string;
  readonly run?: string;
  readonly with?: Record<string, unknown>;
}
interface Workflow {
  readonly jobs?: Record<string, { readonly steps?: readonly Step[] }>;
}

const nodeSetup = (s: Step): boolean =>
  /^actions\/setup-node@/.test(s.uses ?? "") && /^24(\.|$)/.test(String(s.with?.["node-version"]));

/** Faults of one workflow: the same rule per job, on its `setup-node` and `run` steps. */
function workflowFaults(name: string, wf: Workflow): string[] {
  const faults: string[] = [];
  for (const [job, def] of Object.entries(wf.jobs ?? {})) {
    const steps = def.steps ?? [];
    const runs = steps.map((s) => shimsRun(s.run ?? ""));
    const first = runs.findIndex((s) => s.size > 0);
    if (first < 0) continue;
    const where = `${name}#${job}`;
    const setup = steps.findIndex(nodeSetup);
    if (setup < 0 || setup > first) faults.push(`${where}: no setup-node 24 before the first shim`);
    if (!needsDeps(runs.flatMap((s) => [...s]))) continue;
    const install = steps.findIndex((s) => PROD_INSTALL.test((s.run ?? "").trim()));
    if (install < 0) faults.push(`${where}: no production install step`);
    else if (install > first) faults.push(`${where}: install runs after the first shim`);
  }
  return faults;
}

function workflows(): [string, Workflow][] {
  const dir = path.join(REPO, ".github", "workflows");
  return fs
    .readdirSync(dir)
    .filter((f) => /\.ya?ml$/.test(f))
    .sort()
    .map((f): [string, Workflow] => [f, load(`.github/workflows/${f}`) as Workflow]);
}

const CAPS = (load("ci/ci-capabilities.yml") as { capabilities: Capability[] }).capabilities;

describe("jobs that run a model/CI shim declare Node.js 24 and the production install", () => {
  test("the shim-running set was derived", () => {
    assert.ok(
      CAPS.filter((c) => (c.command ?? []).some((x) => shimsRun(String(x)).size)).length > 20,
    );
  });

  test("every capability that runs a shim declares node@24 (and installs where needed)", () => {
    assert.deepEqual(capabilityFaults(CAPS), []);
  });

  test("every GitHub Actions job that runs a shim sets up Node.js 24 (and installs where needed)", () => {
    const faults = workflows().flatMap(([name, wf]) => workflowFaults(name, wf));
    assert.deepEqual(faults, []);
  });
});

describe("the wiring assertions can go red", () => {
  test("a capability without node@24 is reported", () => {
    const caps = structuredClone(CAPS) as unknown as { requires?: { runtime?: unknown } }[];
    const target = CAPS.findIndex((c) => c.id === "check-model-mappings");
    caps[target] = { ...caps[target], requires: { runtime: "node@22" } };
    assert.match(
      capabilityFaults(caps as unknown as Capability[]).join("\n"),
      /check-model-mappings/,
    );
  });

  test("a capability whose install runs after the first shim is reported", () => {
    const base = CAPS.find((c) => c.id === "check-model-mappings") as Capability;
    const swapped = { ...base, command: [...(base.command ?? [])].reverse() };
    assert.match(capabilityFaults([swapped]).join("\n"), /install runs after/);
  });

  test("a capability whose TypeScript test spawns a shim, with no install, is reported", () => {
    const base = CAPS.find((c) => c.id === "changeset-coverage-test") as Capability;
    const bare = { ...base, command: (base.command ?? []).filter((c) => c.includes("--test")) };
    assert.match(capabilityFaults([bare]).join("\n"), /no production install/);
  });

  test("a job without setup-node 24 is reported", () => {
    const wf: Workflow = { jobs: { j: { steps: [{ run: "bash scripts/build-ci.sh --check" }] } } };
    assert.match(workflowFaults("x.yml", wf).join("\n"), /no setup-node 24/);
  });

  test("a wrapper-only job needs Node.js 24 but no install", () => {
    const wf: Workflow = {
      jobs: {
        j: {
          steps: [
            { uses: "actions/setup-node@v4", with: { "node-version": 24 } },
            { run: "bash scripts/ci-cache-guard.sh --stray-scan -- true" },
          ],
        },
      },
    };
    assert.deepEqual(workflowFaults("x.yml", wf), []);
  });
});
