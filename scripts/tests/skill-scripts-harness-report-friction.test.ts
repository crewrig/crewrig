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

const scratch = (name: string): string => {
  const d = path.join(tmp, name);
  fs.mkdirSync(d, { recursive: true });
  return d;
};
const write = (file: string, text: string): string => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
};
const FB = "https://example.test/fb";
const CANON = "https://example.test/canon";
const resolveJson = (args: string[]) => {
  const r = friction(["resolve", ...args, "--json"]);
  return {
    r,
    data: (r.stdout.trim() === "" ? null : JSON.parse(r.stdout)) as {
      data: { fields: Record<string, string>; source: string; evidence: string[] };
    } | null,
  };
};
const manifest = (dir: string, name = "hello-world", pkgName = "hello-world-extension"): void => {
  write(
    path.join(dir, "extension.json"),
    JSON.stringify({ name, provenance: { canonical: CANON } }),
  );
  write(path.join(dir, "package.json"), JSON.stringify({ name: pkgName, version: "2.1.1" }));
};

describe("friction build: provenance fields (spec 0316 R14)", () => {
  const FULL = [
    ...GOOD.slice(0, -2),
    "--package",
    "hello-world-extension",
    "--extension",
    "hello-world",
    "--version",
    "1.2.0",
    "--canonical",
    CANON,
    "--feedback",
    FB,
  ];
  test("the four flags render in the documented order", () => {
    const r = friction(FULL);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(
      r.stdout,
      `FRICTION: Cleanup skill deletes build\n\nwriter_agent: claude-code\npackage: hello-world-extension\nextension: hello-world\nversion: 1.2.0\ncanonical: ${CANON}\nfeedback: ${FB}\nseverity: med\nevidence:\n  - 4f9c2ab:artifacts/core/skills/cleanup/SKILL.md:31\n`,
    );
  });
  test("validate round-trips the new fields", () => {
    const f = path.join(tmp, "full.txt");
    fs.writeFileSync(f, friction(FULL).stdout);
    const r = friction(["validate", f, "--json"]);
    assert.equal(r.status, 0, r.stderr);
    const fields = envelope(r).data as { fields: Record<string, string> };
    assert.equal(fields.fields["package"], "hello-world-extension");
    assert.equal(fields.fields["extension"], "hello-world");
    assert.equal(fields.fields["version"], "1.2.0");
    assert.equal(fields.fields["feedback"], FB);
  });
  test("feedback follows the canonical URL rules", () => {
    const base = GOOD.slice(0, -2);
    assert.equal(friction([...base, "--feedback", "not a url"]).status, 1);
    assert.equal(
      friction([...base, "--feedback", "https://github.com/a/b/blob/main/x.md"]).status,
      1,
    );
  });
  test("a multi-line version is an error, a non-SemVer one a warning", () => {
    const base = GOOD.slice(0, -2);
    assert.equal(friction([...base, "--version", "1.0\n2"]).status, 1);
    const r = friction([...base, "--version", "nightly"]);
    assert.equal(r.status, 0);
    assert.match(r.stderr, /version-not-semver/);
  });
  test("hook: and server: evidence entries are not weak", () => {
    for (const e of ["hook:hello-world/shell-logger", "server:hello-world/greeter-mcp"]) {
      const r = friction([...GOOD.slice(0, 9), "--evidence", e]);
      assert.equal(r.status, 0, r.stderr);
      assert.doesNotMatch(r.stderr, /evidence-weak/);
    }
  });
  test("forge targets the payload feedback and warns on a differing --canonical", () => {
    const f = path.join(tmp, "fb.txt");
    fs.writeFileSync(f, friction(FULL).stdout);
    const r = friction(["forge", "--canonical", CANON, "--payload-file", f, "--forge", "gh"]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /--repo 'example\.test\/fb'|--repo example\.test\/fb|fb' /);
    assert.doesNotMatch(r.stdout, /--repo [^ ]*canon/);
    assert.match(r.stderr, /forge-target-override/);
    const alone = friction(["forge", "--payload-file", f, "--forge", "gh"]);
    assert.equal(alone.status, 0, alone.stderr);
  });
});

describe("friction resolve (spec 0316 R14, R15)", () => {
  test("own YAML marker", () => {
    const f = write(
      path.join(scratch("r-yaml"), "SKILL.md"),
      `---\nname: s\nmetadata:\n  provenance:\n    package: p\n    extension: e\n    version: "1.0.0"\n    canonical: ${CANON}\n    feedback: ${FB}\n---\n# s\n`,
    );
    const { r, data } = resolveJson([f]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(data?.data.source, "marker");
    assert.deepEqual(data?.data.fields, {
      package: "p",
      extension: "e",
      version: "1.0.0",
      canonical: CANON,
      feedback: FB,
    });
  });
  test("a bundled script resolves through the owning skill's SKILL.md marker (R4)", () => {
    const dir = scratch("r-script");
    write(
      path.join(dir, "SKILL.md"),
      `---\nname: s\nmetadata:\n  provenance:\n    canonical: ${CANON}\n    feedback: ${FB}\n    version: "2.0.0"\n---\n# s\n`,
    );
    const f = write(path.join(dir, "scripts", "x.ts"), "export {};\n");
    const { r, data } = resolveJson([f]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(data?.data.source, "marker");
    assert.equal(data?.data.fields["canonical"], CANON);
    assert.equal(data?.data.fields["version"], "2.0.0");
  });
  test("line markers, html comment and hash", () => {
    const line = `crewrig-provenance: package=p extension=e version=3.0.0 canonical=${CANON} feedback=${FB}`;
    for (const [n, text] of [
      ["c", `<!-- ${line} -->\n# x\n`],
      ["h", `# ${line}\necho\n`],
    ] as const) {
      const f = write(path.join(scratch(`r-line-${n}`), "x"), text);
      const { r, data } = resolveJson([f]);
      assert.equal(r.status, 0, r.stderr);
      assert.equal(data?.data.fields["version"], "3.0.0");
      assert.equal(data?.data.source, "marker");
    }
  });
  test("a symlinked skill resolves through its real path to the manifest", () => {
    const root = scratch("r-link");
    manifest(path.join(root, "ext"));
    write(path.join(root, "ext", "skills", "g", "SKILL.md"), "# g\n");
    fs.mkdirSync(path.join(root, "home"), { recursive: true });
    const link = path.join(root, "home", "g");
    fs.symlinkSync(path.join(root, "ext", "skills", "g"), link);
    const { r, data } = resolveJson([path.join(link, "SKILL.md")]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(data?.data.source, "manifest");
    assert.equal(data?.data.fields["extension"], "hello-world");
    assert.equal(data?.data.fields["package"], "hello-world-extension");
  });
  test("a sidecar with --hook yields the hook evidence pair", () => {
    const root = scratch("r-hook");
    write(path.join(root, "hooks", "shell-logger.sh"), "#!/bin/sh\n");
    write(
      path.join(root, "crewrig-provenance.json"),
      JSON.stringify({
        package: "hello-world-extension",
        extension: "hello-world",
        version: "1.0.0",
        canonical: CANON,
        feedback: FB,
      }),
    );
    const { r, data } = resolveJson([
      path.join(root, "hooks", "shell-logger.sh"),
      "--hook",
      "shell-logger",
    ]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(data?.data.source, "sidecar");
    assert.deepEqual(data?.data.evidence, ["hook:hello-world/shell-logger"]);
    const s = friction([
      "resolve",
      path.join(root, "hooks", "shell-logger.sh"),
      "--server",
      "greeter-mcp",
    ]);
    assert.match(s.stdout, /--evidence 'server:hello-world\/greeter-mcp'/);
  });
  test("a sidecar wins over a manifest of the same directory", () => {
    const root = scratch("r-win");
    manifest(root);
    write(
      path.join(root, "crewrig-provenance.json"),
      JSON.stringify({
        package: "side-pkg",
        extension: "hello-world",
        version: "9.9.9",
        canonical: CANON,
        feedback: FB,
      }),
    );
    write(path.join(root, "a.txt"), "x");
    const { data } = resolveJson([path.join(root, "a.txt")]);
    assert.equal(data?.data.fields["package"], "side-pkg");
    assert.equal(data?.data.fields["version"], "9.9.9");
  });
  test("feedback defaults to canonical and a placeholder counts as absent", () => {
    const root = scratch("r-def");
    manifest(root);
    write(path.join(root, "a.txt"), "x");
    assert.equal(resolveJson([path.join(root, "a.txt")]).data?.data.fields["feedback"], CANON);
    const ph = scratch("r-ph");
    write(
      path.join(ph, "extension.json"),
      JSON.stringify({ name: "e", provenance: { canonical: "${CANONICAL_REPO}" } }),
    );
    write(path.join(ph, "a.txt"), "x");
    const { data } = resolveJson([path.join(ph, "a.txt")]);
    assert.equal(data?.data.fields["canonical"], "");
    assert.equal(data?.data.fields["feedback"], "");
  });
  test("the interim spec 0312 carrier merges with the manifest (marker wins, package filled)", () => {
    const root = scratch("r-interim");
    manifest(root, "hello-world", "hello-world-extension");
    const skill = write(
      path.join(root, "skills", "greeter", "SKILL.md"),
      `---\nname: greeter\n---\n<!-- crewrig-provenance: extension=hello-world version=0.9.0 canonical=${CANON} feedback=${FB} -->\n# g\n`,
    );
    const { r, data } = resolveJson([skill]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(data?.data.source, "marker+manifest");
    assert.equal(data?.data.fields["package"], "hello-world-extension");
    assert.equal(data?.data.fields["version"], "0.9.0");
    assert.equal(data?.data.fields["feedback"], FB);
  });
  test("an extension.json of another name fills nothing (identity guard)", () => {
    const root = scratch("r-guard");
    manifest(root, "other-ext", "other-pkg");
    const skill = write(
      path.join(root, "s", "SKILL.md"),
      `<!-- crewrig-provenance: extension=hello-world version=1.0.0 -->\n`,
    );
    const { data } = resolveJson([skill]);
    assert.equal(data?.data.fields["package"], "");
    assert.equal(data?.data.fields["canonical"], "");
    assert.equal(data?.data.source, "marker");
  });
  test("the walk stops at a .git file", () => {
    const root = scratch("r-git");
    manifest(root);
    write(path.join(root, "wt", ".git"), "gitdir: elsewhere\n");
    write(path.join(root, "wt", "a.txt"), "x");
    const r = friction(["resolve", path.join(root, "wt", "a.txt")]);
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stderr, /no-provenance/);
  });
  test("nothing found exits 1, a missing path exits 3, usage exits 2", () => {
    const root = scratch("r-none");
    write(path.join(root, ".git"), "");
    write(path.join(root, "a.txt"), "x");
    assert.equal(friction(["resolve", path.join(root, "a.txt")]).status, 1);
    assert.equal(friction(["resolve", path.join(root, "missing")]).status, 3);
    assert.equal(friction(["resolve"]).status, 2);
  });
});
