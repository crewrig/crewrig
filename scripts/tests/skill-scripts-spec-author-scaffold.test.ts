// skill-scripts-spec-author-scaffold.test.ts — black-box test of spec-author/scripts/scaffold-spec.ts
// (spec 0294 R6 to R10), written from the spec. Every case works in its own throwaway repository.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { after, describe, test } from "node:test";

import { fakeRepo, parseEnvelope, run, tempDir } from "./lib/skill-scripts-spec-author-cli.ts";

const tmp = tempDir("spec-author-scaffold-");
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

let n = 0;
const repo = (opts: { tools?: boolean } = {}) => fakeRepo(tmp, `r${n++}`, opts);
const BASE = ["--issue", "9", "--slug", "demo", "--complexity", "small", "--mode", "AUTO"];
const read = (p: string): string => fs.readFileSync(p, "utf8");
const HEADINGS = [
  "## Intent",
  "## Requirements",
  "## Scenarios",
  "## Out of scope",
  "## Open questions",
];

describe("scaffold-spec: new spec", () => {
  test("pickup, then reservation, then the skeleton; exit 0", () => {
    const r = repo();
    r.reserve("0500");
    const res = run([...BASE, "--json"], { cwd: r.dir });
    assert.equal(res.status, 0, res.stdout + res.stderr);
    const env = parseEnvelope(res);
    assert.equal(env.ok, true);
    assert.equal(env.data?.id, "0500");
    assert.equal(env.data?.unsecured, false);
    assert.deepEqual(
      r.calls().map((c) => c.split(" ")[0]),
      ["ticket-pickup", "reserve-spec-id"],
    );
    assert.ok(
      r.calls().every((c) => c.endsWith("--issue 9")),
      "only --issue is passed to the tools",
    );
    const text = read(path.join(r.dir, "specs", "0500-demo.md"));
    for (const line of [
      'id: "0500"',
      "slug: demo",
      "status: draft",
      "complexity: small",
      "interaction-mode: AUTO",
      "related-issue: 9",
      "version: 1.0.0",
    ])
      assert.ok(text.includes(`\n${line}\n`), line);
    assert.ok(!text.includes("unsecured-id"));
    let at = -1;
    for (const h of HEADINGS) {
      const i = text.indexOf(`\n${h}\n`);
      assert.ok(i > at, `${h} present and in order`);
      at = i;
    }
  });

  test("an unsecured reservation (exit 3) writes unsecured-id: true and still exits 0", () => {
    const r = repo();
    r.reserve("0501", 3);
    const res = run([...BASE, "--json"], { cwd: r.dir });
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.equal(parseEnvelope(res).data?.unsecured, true);
    assert.match(read(path.join(r.dir, "specs", "0501-demo.md")), /\nunsecured-id: true\n---\n/);
  });

  test("a failed reservation (exit 1) writes nothing and exits 1", () => {
    const r = repo();
    r.reserve("0502", 1);
    const res = run([...BASE, "--json"], { cwd: r.dir });
    assert.equal(res.status, 1);
    assert.equal(parseEnvelope(res).findings[0]?.rule, "id-reservation");
    assert.deepEqual(fs.readdirSync(path.join(r.dir, "specs")), []);
  });

  test("a refused ticket pickup stops before the reservation, writes nothing, exits 1", () => {
    const r = repo();
    r.pickup(3);
    const res = run([...BASE, "--json"], { cwd: r.dir });
    assert.equal(res.status, 1);
    const f = parseEnvelope(res).findings[0];
    assert.equal(f?.rule, "ticket-pickup");
    assert.match(f?.message ?? "", /belongs to someone else/);
    assert.deepEqual(
      r.calls().map((c) => c.split(" ")[0]),
      ["ticket-pickup"],
    );
    assert.deepEqual(fs.readdirSync(path.join(r.dir, "specs")), []);
  });

  test("rerunning on an issue you own reruns the pickup and reservation and returns the same id", () => {
    const r = repo();
    r.reserve("0503");
    assert.equal(
      run(
        ["--issue", "9", "--slug", "demo", "--complexity", "small", "--mode", "AUTO", "--id-only"],
        { cwd: r.dir },
      ).stdout.trim(),
      "0503",
    );
    const second = run([...BASE, "--json"], { cwd: r.dir });
    assert.equal(second.status, 0);
    assert.equal(parseEnvelope(second).data?.id, "0503");
    assert.equal(r.calls().length, 4);
  });

  test("--id-only prints the id and writes nothing", () => {
    const r = repo();
    r.reserve("0504");
    const res = run([...BASE, "--id-only"], { cwd: r.dir });
    assert.equal(res.status, 0);
    assert.equal(res.stdout.trim(), "0504");
    assert.deepEqual(fs.readdirSync(path.join(r.dir, "specs")), []);
  });
});

describe("scaffold-spec: refusals (exit 1, nothing written)", () => {
  const refused = (args: string[], rule: string): void => {
    const r = repo();
    const res = run([...args, "--json"], { cwd: r.dir });
    assert.equal(res.status, 1, res.stdout + res.stderr);
    assert.equal(parseEnvelope(res).findings[0]?.rule, rule);
    assert.deepEqual(r.calls(), [], "no tool is called before a refusal");
    assert.deepEqual(fs.readdirSync(path.join(r.dir, "specs")), []);
  };
  test("a slug that is not ASCII kebab-case", () => {
    for (const bad of ["Bad Slug", "UPPER", "a--b", "-a", "é-a", "a".repeat(41)])
      refused(["--issue", "9", "--slug", bad, "--complexity", "small", "--mode", "AUTO"], "slug");
  });
  test("a complexity outside the allowed values", () =>
    refused(
      ["--issue", "9", "--slug", "demo", "--complexity", "huge", "--mode", "AUTO"],
      "complexity",
    ));
  test("a mode outside the allowed values", () =>
    refused(["--issue", "9", "--slug", "demo", "--complexity", "small", "--mode", "auto"], "mode"));
  test("an existing target file", () => {
    const r = repo();
    r.reserve("0505");
    fs.writeFileSync(path.join(r.dir, "specs", "0505-demo.md"), "keep");
    const res = run([...BASE, "--json"], { cwd: r.dir });
    assert.equal(res.status, 1);
    assert.equal(parseEnvelope(res).findings[0]?.rule, "target-exists");
    assert.equal(read(path.join(r.dir, "specs", "0505-demo.md")), "keep");
  });
  test("a branch whose id or slug differs from the reservation", () => {
    for (const branch of ["spec/0999-demo", "spec/0506-other"]) {
      const r = repo();
      r.reserve("0506");
      fs.writeFileSync(path.join(r.dir, "x"), "x");
      for (const g of [
        ["add", "x"],
        ["-c", "user.name=t", "-c", "user.email=t@e.i", "commit", "-q", "-m", "i"],
        ["switch", "-q", "-c", branch],
      ])
        spawnSync("git", g, { cwd: r.dir });
      const res = run([...BASE, "--json"], { cwd: r.dir });
      assert.equal(res.status, 1, branch + res.stderr);
      assert.equal(parseEnvelope(res).findings[0]?.rule, "branch-mismatch");
      assert.deepEqual(fs.readdirSync(path.join(r.dir, "specs")), []);
    }
  });
  test("a matching branch is accepted", () => {
    const r = repo();
    r.reserve("0507");
    fs.writeFileSync(path.join(r.dir, "x"), "x");
    for (const g of [
      ["add", "x"],
      ["-c", "user.name=t", "-c", "user.email=t@e.i", "commit", "-q", "-m", "i"],
      ["switch", "-q", "-c", "spec/0507-demo"],
    ])
      spawnSync("git", g, { cwd: r.dir });
    assert.equal(run(BASE, { cwd: r.dir }).status, 0);
  });
});

describe("scaffold-spec: delta mode", () => {
  const withParent = (): ReturnType<typeof fakeRepo> => {
    const r = repo();
    fs.writeFileSync(
      path.join(r.dir, "specs", "0100-demo.md"),
      '---\nid: "0100"\nslug: demo\nstatus: approved\ncomplexity: standard\ninteraction-mode: FULL\nrelated-issue: 1\nversion: 1.2.0\n---\n\n# Demo title\n\n## Intent\n\nx\n',
    );
    return r;
  };
  test("writes the next delta with the three headings and calls no tool", () => {
    const r = withParent();
    fs.writeFileSync(path.join(r.dir, "specs", "0100-demo.delta-01.md"), "d1");
    const res = run(["--delta", "--parent", "0100", "--issue", "7", "--json"], { cwd: r.dir });
    assert.equal(res.status, 0, res.stdout + res.stderr);
    assert.deepEqual(r.calls(), []);
    const text = read(path.join(r.dir, "specs", "0100-demo.delta-02.md"));
    assert.match(
      text,
      /^---\nid: "0100"\nslug: demo\nstatus: draft\ncomplexity: standard\ninteraction-mode: FULL\nrelated-issue: 7\nversion: 1\.3\.0\n---\n\n# Demo title\n\n## ADDED\n\n## MODIFIED\n\n## REMOVED\n$/,
    );
    assert.ok(!text.includes("## Intent"));
  });
  test("a missing --parent is a usage error (exit 2)", () => {
    const r = withParent();
    const res = run(["--delta", "--issue", "7", "--json"], { cwd: r.dir });
    assert.equal(res.status, 2);
    assert.equal(parseEnvelope(res).findings[0]?.rule, "usage");
  });
  test("an unknown parent exits 1 and writes nothing", () => {
    const r = withParent();
    const res = run(["--delta", "--parent", "0999", "--issue", "7", "--json"], { cwd: r.dir });
    assert.equal(res.status, 1);
    assert.equal(parseEnvelope(res).findings[0]?.rule, "parent-missing");
    assert.deepEqual(fs.readdirSync(path.join(r.dir, "specs")).sort(), ["0100-demo.md"]);
  });
});

describe("scaffold-spec: preconditions, dry run, contract", () => {
  test("repository tools absent: exit 3 naming the manual equivalent", () => {
    const r = repo({ tools: false });
    const res = run([...BASE, "--json"], { cwd: r.dir });
    assert.equal(res.status, 3);
    const env = parseEnvelope(res);
    assert.equal(env.ok, false);
    assert.equal(env.data, null);
    assert.equal(env.findings[0]?.rule, "precondition");
    assert.match(env.findings[0]?.message ?? "", /Manual equivalent/);
    assert.deepEqual(fs.readdirSync(path.join(r.dir, "specs")), []);
  });
  test("--dry-run runs no tool, writes nothing, prints path, content and commands, even with no tools", () => {
    const r = repo({ tools: false });
    const res = run([...BASE, "--dry-run"], { cwd: r.dir });
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /specs\/NNNN-demo\.md/);
    assert.match(res.stdout, /scripts\/ticket-pickup\.ts --issue 9/);
    assert.match(res.stdout, /scripts\/reserve-spec-id\.ts --issue 9/);
    assert.match(res.stdout, /\n## Open questions\n/);
    assert.deepEqual(fs.readdirSync(path.join(r.dir, "specs")), []);
    const j = parseEnvelope(run([...BASE, "--dry-run", "--json"], { cwd: r.dir }));
    assert.equal(j.data?.written, false);
    assert.equal(j.data?.dry_run, true);
  });
  test("runs outside any git repository with --dry-run", () => {
    const dir = tempDir("spec-author-nogit-");
    try {
      const res = run([...BASE, "--dry-run", "--json"], { cwd: dir });
      assert.equal(res.status, 0, res.stderr);
      assert.equal(parseEnvelope(res).ok, true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  test("usage errors exit 2 with the --json object", () => {
    const r = repo();
    for (const args of [
      ["--bogus"],
      ["--issue", "x", "--slug", "a", "--complexity", "small", "--mode", "AUTO"],
      ["--slug", "a", "--complexity", "small", "--mode", "AUTO"],
      [...BASE, "--id"],
      [...BASE, "extra"],
      [...BASE, "--parent", "0001"],
      ["--delta", "--parent", "0001", "--issue", "1", "--id-only"],
    ]) {
      const res = run([...args, "--json"], { cwd: r.dir });
      assert.equal(res.status, 2, args.join(" "));
      const env = parseEnvelope(res);
      assert.equal(env.ok, false);
      assert.equal(env.findings[0]?.rule, "usage");
    }
  });
  test("there is no --id option", () => {
    const r = repo();
    assert.equal(run([...BASE, "--id", "0001"], { cwd: r.dir }).status, 2);
  });
  test("--help prints the usage on stdout, exits 0, and says who writes to the forge", () => {
    const res = run(["--help"], { cwd: tmp });
    assert.equal(res.status, 0);
    assert.equal(res.stderr, "");
    assert.match(res.stdout, /^Usage: /);
    assert.match(res.stdout, /written by the two\s+repository tools/);
  });
  test("both --opt value and --opt=value forms are accepted", () => {
    const r = repo();
    r.reserve("0508");
    const res = run(["--issue=9", "--slug=demo", "--complexity=small", "--mode=AUTO"], {
      cwd: r.dir,
    });
    assert.equal(res.status, 0, res.stderr);
  });
});
