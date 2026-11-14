// skill-scripts-security-dep-audit.test.ts — dep-audit.ts (spec 0303 R10, R13), driven only through
// `npm` and `pip-audit` stubs on PATH that replay the real captures of
// fixtures/skill-scripts/security-0303/captures/ (see its PROVENANCE.txt), from a copy of the built
// skill outside the repository, with no network.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, beforeEach, describe, test } from "node:test";

import {
  copySkill,
  envelope,
  gone,
  run,
  tempDir,
  toolStubs,
  type Envelope,
  type Run,
} from "./lib/skill-scripts-security-cli.ts";

const REPO = path.resolve(import.meta.dirname, "..", "..");
const root = tempDir("security-dep-audit-");
after(() => fs.rmSync(root, { recursive: true, force: true }));
assert.ok(!root.startsWith(REPO), "the copy must live outside the repository");
const skill = copySkill(root);
const tools = toolStubs(root);
beforeEach(() => tools.reset());

const LOCK = JSON.stringify({
  lockfileVersion: 3,
  packages: {
    "": {},
    "node_modules/semver": { version: "5.7.1" },
    "node_modules/cookie": { version: "0.4.0" },
  },
});
const NPM_ARGS = ["npm", "audit", "--json", "--package-lock-only", "--ignore-scripts"];
const PIP_ARGS = [
  "pip-audit",
  "-r",
  "requirements.txt",
  "--disable-pip",
  "--no-deps",
  "--format",
  "json",
  "--progress-spinner",
  "off",
];

let counter = 0;
/** A project root holding `files`, under the copy's work area. */
function project(files: Record<string, string>): string {
  const dir = path.join(root, "work", `p${(counter += 1)}`);
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
  return dir;
}
const NPM_LOCK = { "package-lock.json": LOCK, "package.json": "{}" };
const PIP_FILE = { "requirements.txt": "idna==3.6\n" };

function audit(dir: string, args: string[], env: Record<string, string>, timeoutMs?: number): Run {
  return run(skill, "dep-audit", ["--root", dir, "--json", ...args], {
    cwd: root,
    env,
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
}
const audited = (e: Envelope): { ecosystem: string; verdict: string; cause?: string }[] =>
  (e.data?.["audited"] ?? []) as { ecosystem: string; verdict: string; cause?: string }[];

describe("npm", () => {
  test("clean capture: exit 0, verdict clean, the fixed argument vector, no finding", () => {
    const r = audit(project(NPM_LOCK), [], tools.replay({ npm: "clean" }));
    assert.equal(r.status, 0, r.stderr);
    const e = envelope(r);
    assert.equal(e.ok, true);
    assert.deepEqual(e.findings, []);
    assert.deepEqual(
      audited(e).map((a) => [a.ecosystem, a.verdict]),
      [["npm", "clean"]],
    );
    assert.deepEqual(tools.calls(), [NPM_ARGS]);
  });

  test("vulnerable capture: the high advisory is an error, the low one a warning, exit 1", () => {
    const r = audit(project(NPM_LOCK), [], tools.replay({ npm: "vulnerable" }));
    assert.equal(r.status, 1, r.stderr);
    const e = envelope(r);
    assert.equal(e.ok, false);
    const bySeverity: Record<string, string | undefined> = {};
    for (const f of e.findings) bySeverity[/semver|cookie/.exec(f.message)?.[0] ?? ""] = f.severity;
    assert.deepEqual(bySeverity, { semver: "error", cookie: "warning" });
    const high = e.findings.find((f) => f.message.startsWith("semver"));
    assert.match(high?.message ?? "", /semver 5\.7\.1: .*severity high, fixed in 5\.7\.3/);
    assert.match(high?.message ?? "", /Reachability was not assessed/);
    assert.equal(audited(e)[0]?.verdict, "vulnerable");
  });

  test("--fail-on moves the line: low makes both errors, critical makes both warnings and exit 0", () => {
    const env = tools.replay({ npm: "vulnerable" });
    const low = audit(project(NPM_LOCK), ["--fail-on", "low"], env);
    assert.equal(low.status, 1);
    assert.deepEqual(
      envelope(low).findings.map((f) => f.severity),
      ["error", "error"],
    );
    const critical = audit(project(NPM_LOCK), ["--fail-on", "critical"], env);
    assert.equal(critical.status, 0, critical.stderr);
    assert.deepEqual(
      envelope(critical).findings.map((f) => f.severity),
      ["warning", "warning"],
    );
  });

  test("an offline capture is exit 3 with cause offline, never clean", () => {
    const r = audit(project(NPM_LOCK), [], tools.replay({ npm: "offline" }));
    assert.equal(r.status, 3, r.stderr);
    const e = envelope(r);
    assert.deepEqual(
      audited(e).map((a) => [a.verdict, a.cause]),
      [["not-audited", "offline"]],
    );
    const pre = e.findings.find((f) => f.rule === "precondition");
    assert.equal(pre?.cause, "offline");
    assert.match(pre?.message ?? "", /NOT audited/);
  });

  test("a missing tool is exit 3 with cause tool-missing", () => {
    const r = audit(project(NPM_LOCK), [], { PATH: tools.empty });
    assert.equal(r.status, 3);
    assert.equal(envelope(r).findings[0]?.cause, "tool-missing");
  });

  test("an unrecognised output is exit 3 with cause unrecognized-output, never clean", () => {
    const dir = path.join(root, "derived-npm");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "stdout"), "this is not json\n");
    fs.writeFileSync(path.join(dir, "stderr"), "");
    fs.writeFileSync(path.join(dir, "status"), "0\n");
    const r = audit(project(NPM_LOCK), [], tools.replay({ npm: dir }));
    assert.equal(r.status, 3);
    assert.equal(envelope(r).findings[0]?.cause, "unrecognized-output");
  });

  test("a package.json without a lockfile is exit 3 with cause no-lockfile and no tool call", () => {
    const r = audit(project({ "package.json": "{}" }), [], tools.replay({ npm: "clean" }));
    assert.equal(r.status, 3);
    assert.equal(envelope(r).findings[0]?.cause, "no-lockfile");
    assert.deepEqual(tools.calls(), []);
  });

  test("a hanging tool is stopped at --timeout: exit 3, cause timeout, no process left", () => {
    const pidFile = path.join(root, "npm.pid");
    const r = audit(project(NPM_LOCK), ["--timeout", "1"], tools.hang("npm", pidFile), 30_000);
    assert.equal(r.status, 3, r.stderr);
    assert.equal(envelope(r).findings[0]?.cause, "timeout");
    const stub = Number(fs.readFileSync(pidFile, "utf8"));
    const grandchild = Number(fs.readFileSync(`${pidFile}.child`, "utf8"));
    assert.ok(gone(stub), "the stub is gone");
    assert.ok(gone(grandchild), "the stub's grandchild is gone (ESRCH)");
  });
});

describe("pip", () => {
  test("clean capture: exit 0, the non-building vector", () => {
    const r = audit(project(PIP_FILE), [], tools.replay({ pip: "clean" }));
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(
      audited(envelope(r)).map((a) => [a.ecosystem, a.verdict]),
      [["pip", "clean"]],
    );
    assert.deepEqual(tools.calls(), [PIP_ARGS]);
    assert.ok(!tools.calls()[0]?.includes("--strict"));
  });

  test("vulnerable capture: advisories deduplicated by id, no severity counts as at or above", () => {
    const r = audit(
      project(PIP_FILE),
      ["--fail-on", "critical"],
      tools.replay({ pip: "vulnerable" }),
    );
    assert.equal(r.status, 1, r.stderr);
    const e = envelope(r);
    assert.equal(e.findings.length, 2, "four entries, two distinct ids");
    assert.ok(e.findings.every((f) => f.severity === "error"));
    assert.match(e.findings[0]?.message ?? "", /idna 3\.6: PYSEC-2024-60, severity not reported/);
    assert.match(e.findings[0]?.message ?? "", /fixed in 3\.7/);
  });

  test("an offline capture is exit 3 with cause offline, with and without --strict", () => {
    for (const c of ["offline", "offline-strict"]) {
      const r = audit(project(PIP_FILE), [], tools.replay({ pip: c }));
      assert.equal(r.status, 3, c);
      assert.equal(envelope(r).findings[0]?.cause, "offline", c);
    }
  });

  test("an unpinned requirement is exit 3 with cause unpinned", () => {
    const r = audit(project(PIP_FILE), [], tools.replay({ pip: "unpinned" }));
    assert.equal(r.status, 3);
    assert.equal(envelope(r).findings[0]?.cause, "unpinned");
  });

  test("a skipped dependency never reads as clean, whatever the exit code of the tool", () => {
    for (const c of [
      "private-pinned",
      "url-requirement",
      "private-pinned-strict",
      "url-requirement-strict",
      "default-invocation-builds",
    ]) {
      const r = audit(project(PIP_FILE), [], tools.replay({ pip: c }));
      assert.equal(r.status, 3, c);
      const e = envelope(r);
      assert.equal(audited(e)[0]?.verdict, "not-audited", c);
      assert.equal(audited(e)[0]?.cause, "unrecognized-output", c);
    }
    const e = envelope(audit(project(PIP_FILE), [], tools.replay({ pip: "private-pinned" })));
    assert.match(
      e.findings[0]?.message ?? "",
      /acme-internal-lib was skipped by the tool .* never clean/,
    );
  });

  test("a missing tool is exit 3 with cause tool-missing", () => {
    const r = audit(project(PIP_FILE), [], { PATH: tools.empty });
    assert.equal(r.status, 3);
    assert.equal(envelope(r).findings[0]?.cause, "tool-missing");
  });

  test("a hanging tool is stopped at --timeout and leaves no process", () => {
    const pidFile = path.join(root, "pip.pid");
    const r = audit(project(PIP_FILE), ["--timeout", "1"], tools.hang("pip", pidFile), 30_000);
    assert.equal(r.status, 3, r.stderr);
    assert.equal(envelope(r).findings[0]?.cause, "timeout");
    assert.ok(gone(Number(fs.readFileSync(pidFile, "utf8"))));
    assert.ok(gone(Number(fs.readFileSync(`${pidFile}.child`, "utf8"))));
  });
});

describe("roots and ecosystems", () => {
  test("a root with no manifest is exit 0 with a nothing-to-audit warning and an empty audited list", () => {
    const r = audit(project({}), [], tools.replay({ npm: "clean" }));
    assert.equal(r.status, 0, r.stderr);
    const e = envelope(r);
    assert.deepEqual(audited(e), []);
    assert.deepEqual(
      e.findings.map((f) => [f.rule, f.severity]),
      [["nothing-to-audit", "warning"]],
    );
    assert.deepEqual(tools.calls(), []);
  });

  test("an unsupported manifest alone: warning naming the native tool, manifests found, none audited: exit 3", () => {
    const r = audit(project({ "go.mod": "module x\n" }), [], tools.replay({}));
    assert.equal(r.status, 3);
    const e = envelope(r);
    const w = e.findings.find((f) => f.rule === "unsupported-ecosystem");
    assert.equal(w?.severity, "warning");
    assert.match(w?.message ?? "", /go\.mod: its dependencies were NOT audited; run govulncheck/);
    assert.deepEqual(tools.calls(), []);
  });

  test("an unsupported manifest next to an audited clean one is still exit 0 and keeps the warning", () => {
    const r = audit(project({ ...NPM_LOCK, "yarn.lock": "" }), [], tools.replay({ npm: "clean" }));
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(
      envelope(r).findings.map((f) => f.rule),
      ["unsupported-ecosystem"],
    );
  });

  test("a mixed root: a finding wins over a precondition and data lists every ecosystem", () => {
    const r = audit(
      project({ ...NPM_LOCK, ...PIP_FILE }),
      [],
      tools.replay({ npm: "vulnerable", pip: "offline" }),
    );
    assert.equal(r.status, 1, r.stderr);
    const e = envelope(r);
    assert.deepEqual(
      audited(e).map((a) => [a.ecosystem, a.verdict]),
      [
        ["npm", "vulnerable"],
        ["pip", "not-audited"],
      ],
    );
    assert.ok(e.findings.some((f) => f.rule === "precondition" && f.ecosystem === "pip"));
  });

  test("--ecosystem restricts the run; a named ecosystem with no manifest is exit 3 with data null", () => {
    const both = project({ ...NPM_LOCK, ...PIP_FILE });
    const only = audit(
      both,
      ["--ecosystem", "pip"],
      tools.replay({ pip: "clean", npm: "vulnerable" }),
    );
    assert.equal(only.status, 0, only.stderr);
    assert.deepEqual(
      tools.calls().map((c) => c[0]),
      ["pip-audit"],
    );
    const none = audit(project(PIP_FILE), ["--ecosystem", "npm"], tools.replay({ npm: "clean" }));
    assert.equal(none.status, 3);
    assert.equal(envelope(none).data, null);
  });
});

describe("check order and the CLI", () => {
  test("arguments first (2), then the root (3), then the tools", () => {
    const missing = path.join(root, "no-such-dir");
    const usage = run(skill, "dep-audit", ["--root", missing, "--ecosystem", "rust"], {
      cwd: root,
    });
    assert.equal(usage.status, 2);
    const badRoot = run(skill, "dep-audit", ["--root", missing, "--json"], {
      cwd: root,
      env: tools.replay({}),
    });
    assert.equal(badRoot.status, 3);
    assert.equal(envelope(badRoot).data, null);
    assert.deepEqual(tools.calls(), []);
  });

  for (const [name, args] of [
    ["an unknown option", ["--nope"]],
    ["an unexpected argument", ["extra"]],
    ["a missing value", ["--fail-on"]],
    ["an option given twice", ["--fail-on", "low", "--fail-on", "high"]],
    ["--fail-on info", ["--fail-on", "info"]],
    ["--fail-on unknown", ["--fail-on", "severe"]],
    ["--timeout zero", ["--timeout", "0"]],
    ["--timeout not a number", ["--timeout", "soon"]],
    ["--ecosystem unknown", ["--ecosystem", "cargo"]],
  ] as [string, string[]][])
    test(`usage error, exit 2: ${name}`, () => {
      const r = run(skill, "dep-audit", ["--root", project({}), ...args], { cwd: root });
      assert.equal(r.status, 2, r.stdout);
      assert.equal(r.stdout, "");
      assert.match(r.stderr, /usage/);
    });

  test("--root=<dir> and --json: one stdout line {ok, data, findings}, the text on stderr", () => {
    const dir = project(NPM_LOCK);
    const r = run(skill, "dep-audit", [`--root=${dir}`, "--json"], {
      cwd: root,
      env: tools.replay({ npm: "clean" }),
    });
    assert.equal(r.status, 0);
    const e = envelope(r);
    assert.deepEqual(Object.keys(e), ["ok", "data", "findings"]);
    assert.deepEqual(Object.keys(e.data ?? {}), ["root", "failOn", "audited"]);
    assert.equal(r.stderr, "dep-audit: nothing to report\n");
  });

  test("without --json the findings go to stdout (exit 0 or 1) and to stderr from exit 2", () => {
    const r = run(skill, "dep-audit", ["--root", project(NPM_LOCK)], {
      cwd: root,
      env: tools.replay({ npm: "vulnerable" }),
    });
    assert.equal(r.status, 1);
    assert.match(r.stdout, /^\[error\] vulnerable-dependency: semver 5\.7\.1/m);
    assert.equal(r.stderr, "");
  });

  test("--help: exit 0, states the vectors, the network use and the --no-deps scope", () => {
    const r = run(skill, "dep-audit", ["--help"], { cwd: root });
    assert.equal(r.status, 0);
    assert.equal(r.stderr, "");
    assert.match(r.stdout, /npm audit --json --package-lock-only --ignore-scripts/);
    assert.match(r.stdout, /--disable-pip --no-deps --format json/);
    assert.match(r.stdout, /query a package registry over the network/);
    assert.match(r.stdout, /--no-deps audits only the pins written in the file/);
    assert.match(r.stdout, /POSIX hosts only/);
  });
});
