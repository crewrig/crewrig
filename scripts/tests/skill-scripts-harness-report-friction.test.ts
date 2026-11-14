// Black-box test of harness-report/scripts/friction.ts: build, validate and forge.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import { envelope, run, tempDir } from "./lib/skill-scripts-governance-cli.ts";

const tmp = tempDir("friction-");
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const friction = (args: string[], opts: Parameters<typeof run>[3] = {}) =>
  run("harness-report", "friction.ts", args, opts);
const GOOD = [
  "build",
  "--title",
  "Cleanup skill deletes build",
  "--room",
  "prompt",
  "--writer-agent",
  "claude-code",
  "--evidence",
  "4f9c2ab:artifacts/core/skills/cleanup/SKILL.md:31",
  "--canonical",
  "https://github.com/acme/agent-config",
];
const payloadFile = (): string => {
  const f = path.join(tmp, "payload.txt");
  fs.writeFileSync(f, friction(GOOD).stdout);
  return f;
};

describe("friction build", () => {
  test("prints the payload on stdout, in the documented layout", () => {
    const r = friction(GOOD);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(
      r.stdout,
      "FRICTION: Cleanup skill deletes build\n\nwriter_agent: claude-code\ncanonical: https://github.com/acme/agent-config\nseverity: med\nevidence:\n  - 4f9c2ab:artifacts/core/skills/cleanup/SKILL.md:31\n",
    );
  });
  test("optional fields, several evidence entries and a multi-line suggestion", () => {
    const r = friction([
      ...GOOD,
      "--evidence",
      "https://example.com/run/1",
      "--subcategory",
      "rm-rf",
      "--severity",
      "high",
      "--suggestion",
      "line one\nline two",
      "--json",
    ]);
    const p = envelope(r).data?.["payload"] as string;
    assert.match(p, /\nsubcategory: rm-rf\n/);
    assert.match(p, /\nseverity: high\n/);
    assert.match(p, /\n {2}- https:\/\/example\.com\/run\/1\n/);
    assert.match(p, /\nsuggestion: \|\n {2}line one\n {2}line two$/);
    assert.equal(envelope(r).data?.["wing"], "harness-friction");
  });
  test("missing writer_agent and missing evidence are errors, exit 1, no payload", () => {
    const r = friction(["build", "--title", "t", "--room", "tool", "--json"]);
    assert.equal(r.status, 1);
    const e = envelope(r);
    assert.deepEqual(e.findings.map((f) => f.rule).sort(), ["evidence", "writer-agent"]);
    assert.equal(e.data?.["payload"], null);
  });
  test("a file URL as canonical, a bad room and a bad severity are errors", () => {
    const a = friction(
      GOOD.map((x) =>
        x === "https://github.com/acme/agent-config"
          ? "https://github.com/acme/agent-config/blob/main/x.md"
          : x,
      ).concat("--json"),
    );
    assert.equal(envelope(a).findings[0]?.rule, "canonical-file-url");
    const b = friction([
      ...GOOD.map((x) => (x === "prompt" ? "nonsense" : x)),
      "--severity",
      "urgent",
      "--json",
    ]);
    assert.deepEqual(
      envelope(b)
        .findings.map((f) => f.rule)
        .sort(),
      ["room", "severity"],
    );
  });
  test("an evidence entry without a line number is a warning only", () => {
    const r = friction([
      "build",
      "--title",
      "t",
      "--room",
      "tool",
      "--writer-agent",
      "a",
      "--evidence",
      "somefile.md",
      "--json",
    ]);
    assert.equal(r.status, 0);
    assert.equal(envelope(r).findings[0]?.severity, "warning");
  });
  test("--room is required (exit 2)", () => {
    assert.equal(friction(["build", "--title", "t"]).status, 2);
  });
});

describe("friction validate", () => {
  test("a built payload validates; --room is checked when given", () => {
    const f = payloadFile();
    assert.equal(friction(["validate", f]).status, 0);
    assert.equal(friction(["validate", f, "--room", "nonsense"]).status, 1);
  });
  test("standard input; a payload without writer_agent or evidence fails", () => {
    const r = friction(["validate", "-", "--json"], { input: "FRICTION: t\n\nseverity: med\n" });
    assert.equal(r.status, 1);
    assert.deepEqual(
      envelope(r)
        .findings.map((f) => f.rule)
        .sort(),
      ["evidence", "writer-agent"],
    );
  });
  test("a payload that does not start with the FRICTION title fails", () => {
    const r = friction(["validate", "-", "--json"], { input: "just words\n" });
    assert.equal(envelope(r).findings[0]?.rule, "title");
  });
  test("the inline evidence short form is accepted", () => {
    const r = friction(["validate", "-"], {
      input: "FRICTION: t\n\nwriter_agent: a\nevidence: x.md:3\n",
    });
    assert.equal(r.status, 0);
  });
  test("an unreadable file exits 3", () => {
    assert.equal(friction(["validate", path.join(tmp, "nope")]).status, 3);
  });
});

describe("friction forge", () => {
  const forge = (canonical: string, extra: string[] = [], env: Record<string, string> = {}) =>
    friction(
      ["forge", "--canonical", canonical, "--payload-file", payloadFile(), "--json", ...extra],
      { env },
    );
  test("github.com selects gh with owner/repo and --body", () => {
    const e = envelope(forge("https://github.com/acme/agent-config"));
    assert.equal(e.data?.["forge"], "gh");
    const argv = e.data?.["argv"] as string[];
    assert.deepEqual(argv.slice(0, 8), [
      "gh",
      "issue",
      "create",
      "--repo",
      "acme/agent-config",
      "--label",
      "harness-feedback",
      "--title",
    ]);
    assert.ok(argv.includes("--body"));
    assert.equal(argv[argv.indexOf("--title") + 1], "FRICTION: Cleanup skill deletes build");
  });
  test("a file URL as canonical is stripped to the repository root", () => {
    const e = envelope(
      friction([
        "forge",
        "--canonical",
        "https://github.com/acme/agent-config/blob/main/x.md",
        "--payload-file",
        payloadFile(),
        "--json",
      ]),
    );
    assert.equal(e.ok, false);
    assert.equal(e.findings[0]?.rule, "canonical-file-url");
  });
  test("gitlab.com selects glab with the full URL and --description", () => {
    const e = envelope(forge("https://gitlab.com/acme/platform/agent-config"));
    assert.equal(e.data?.["forge"], "glab");
    const argv = e.data?.["argv"] as string[];
    assert.equal(argv[argv.indexOf("--repo") + 1], "https://gitlab.com/acme/platform/agent-config");
    assert.ok(argv.includes("--description") && !argv.includes("--body"));
  });
  test("another host selects tea with owner/repo and the plural --labels", () => {
    const e = envelope(forge("https://git.acme.internal/platform/agent-config"));
    assert.equal(e.data?.["forge"], "tea");
    const argv = e.data?.["argv"] as string[];
    assert.deepEqual(argv.slice(0, 7), [
      "tea",
      "issues",
      "create",
      "--repo",
      "platform/agent-config",
      "--labels",
      "harness-feedback",
    ]);
  });
  test("CREWRIG_GITLAB_HOSTS and --forge override the host rule", () => {
    assert.equal(
      envelope(forge("https://code.acme.io/g/p", [], { CREWRIG_GITLAB_HOSTS: "code.acme.io" }))
        .data?.["forge"],
      "glab",
    );
    assert.equal(
      envelope(forge("https://github.com/a/b", ["--forge", "tea"])).data?.["forge"],
      "tea",
    );
  });
  test("the printed command carries the body in a quoted heredoc and the payload minus its title", () => {
    const r = friction([
      "forge",
      "--canonical",
      "https://github.com/acme/agent-config",
      "--payload-file",
      payloadFile(),
    ]);
    assert.equal(r.status, 0);
    assert.match(
      r.stdout,
      /^gh issue create --repo 'acme\/agent-config' --label 'harness-feedback' --title 'FRICTION: Cleanup skill deletes build' --body "\$\(cat <<'FRICTION_EOF'\nwriter_agent: claude-code\n/,
    );
    assert.match(r.stdout, /\nFRICTION_EOF\n\)"\n$/);
  });
  test("usage: canonical and payload file are required, --forge is checked", () => {
    assert.equal(friction(["forge", "--payload-file", payloadFile()]).status, 2);
    assert.equal(friction(["forge", "--canonical", "https://github.com/a/b"]).status, 2);
    assert.equal(forge("https://github.com/a/b", ["--forge", "svn"]).status, 2);
    assert.equal(
      friction([
        "forge",
        "--canonical",
        "https://github.com/a/b",
        "--payload-file",
        path.join(tmp, "nope"),
      ]).status,
      3,
    );
  });
  test("--help exits 0 and an unknown command exits 2", () => {
    assert.equal(friction(["--help"]).status, 0);
    assert.equal(friction(["frobnicate"]).status, 2);
  });
});
