// skill-scripts-init-config.test.ts — black-box test of the scaffold-config-file.ts and
// lint-config-file.ts scripts shared by init-team and init-expertise: filename derivation, refusal
// to overwrite, rendering per kind, dry run, exit codes, --json shape, byte-identical copies, and
// the round trip scaffold -> lint plus the lint of the shipped catalog.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

const REPO = path.resolve(import.meta.dirname, "..", "..");
const SKILLS = path.join(REPO, "artifacts", "core", "skills");
const SCAFFOLD = path.join(SKILLS, "init-team", "scripts", "scaffold-config-file.ts");
const LINT = path.join(SKILLS, "init-team", "scripts", "lint-config-file.ts");
const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "init-config-")));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

interface Run {
  status: number | null;
  stdout: string;
  stderr: string;
}
function node(entry: string, args: string[], input?: string): Run {
  const r = spawnSync(process.execPath, [entry, ...args], {
    cwd: tmp,
    env: { HOME: tmp, PATH: path.dirname(process.execPath), LC_ALL: "C" },
    encoding: "utf8",
    timeout: 30_000,
    ...(input === undefined ? {} : { input }),
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}
interface Env {
  ok: boolean;
  data: Record<string, unknown> | null;
  findings: { rule: string; message: string; severity?: string }[];
}
const env = (r: Run): Env => {
  const lines = r.stdout.split("\n").filter((l) => l !== "");
  assert.equal(lines.length, 1, r.stdout);
  return JSON.parse(lines[0] as string) as Env;
};
let n = 0;
const fresh = (): string => {
  const d = path.join(tmp, `root${n++}`);
  fs.mkdirSync(d);
  return d;
};
const scaffold = (root: string, kind: string, answers: unknown, extra: string[] = []): Run =>
  node(
    SCAFFOLD,
    ["--kind", kind, "--answers", "-", "--root", root, "--json", ...extra],
    JSON.stringify(answers),
  );
const lint = (kind: string, file: string): Run => node(LINT, ["--kind", kind, file, "--json"]);

const TEAM = {
  name: "Data Platform",
  tagline: "Analytics",
  mission: "Build it.",
  stack: ["Python", "- dbt"],
  practices: ["Test all"],
  key_contacts: ["Slack: #dp"],
};
const EXPERTISE = {
  name: "Data Engineer",
  shape: "responsibilities",
  summary: "You assist a data engineer.",
  items: ["Own pipelines"],
  practices: ["Test backfills"],
};
const PROFILE = {
  identity: { full_name: "Ada Lovelace", email: "ada@example.com", language: "English" },
  projects: [{ name: "Engine", responsibility: "Lead", objective: "Ship" }],
  growth: { focus: "Rust" },
};
const SOUL = {
  sections: {
    stance: "Direct.",
    origin: "Model.",
    understanding: "- Honest.",
    lineage: "Memory.",
    error_handling: "- Own it.",
  },
};

describe("scaffold-config-file", () => {
  test("--help exits 0 with a usage", () => {
    for (const s of [SCAFFOLD, LINT]) {
      const r = node(s, ["--help"]);
      assert.equal(r.status, 0);
      assert.match(r.stdout, /^Usage:/);
    }
  });

  test("resolve derives the filename and reports existence, accents dropped", () => {
    const root = fresh();
    const r = node(SCAFFOLD, [
      "--kind",
      "team",
      "--name",
      "Équipe  data/platform!",
      "--root",
      root,
      "--json",
    ]);
    assert.equal(r.status, 0);
    const e = env(r);
    assert.equal(e.data?.["file"], "EQUIPE-DATA-PLATFORM.md");
    assert.equal(e.data?.["exists"], false);
    assert.equal(e.data?.["mode"], "resolve");
  });

  test("a team and an expertise file are written where the kind says, and lint clean", () => {
    const root = fresh();
    assert.equal(scaffold(root, "team", TEAM).status, 0);
    assert.equal(scaffold(root, "expertise", EXPERTISE).status, 0);
    const team = path.join(root, "config", "teams", "DATA-PLATFORM.md");
    const exp = path.join(root, "config", "expertise", "DATA-ENGINEER.md");
    assert.match(
      fs.readFileSync(team, "utf8"),
      /^# Team Data Platform — Analytics\n\n## Mission\n\nBuild it\.\n\n## Technology Stack\n\n- Python\n- dbt\n/,
    );
    assert.match(
      fs.readFileSync(exp, "utf8"),
      /^# Data Engineer\n\nYou assist a data engineer\.\n\n## Responsibilities\n\n- Own pipelines\n\n## Key Practices\n\n- Test backfills\n$/,
    );
    assert.equal(lint("team", team).status, 0);
    assert.equal(lint("expertise", exp).status, 0);
  });

  test("profile and soul round-trip through the linter", () => {
    const root = fresh();
    assert.equal(scaffold(root, "profile", PROFILE, ["--date", "2026-01-02"]).status, 0);
    assert.equal(scaffold(root, "soul", SOUL).status, 0);
    const profile = fs.readFileSync(path.join(root, "config", "PROFILE.md"), "utf8");
    assert.match(profile, /- \*\*Full Name:\*\* Ada Lovelace/);
    assert.match(profile, /1\. \*\*Engine\*\*\n {3}- \*\*Responsibility:\*\* Lead/);
    assert.match(profile, /\*\*Last Updated:\*\* 2026-01-02\n$/);
    assert.equal(lint("profile", path.join(root, "config", "PROFILE.md")).status, 0);
    assert.equal(lint("soul", path.join(root, "config", "SOUL.md")).status, 0);
  });

  test("an existing target is refused with the rule target-exists, untouched, unless --force", () => {
    const root = fresh();
    assert.equal(scaffold(root, "team", TEAM).status, 0);
    const file = path.join(root, "config", "teams", "DATA-PLATFORM.md");
    const before = fs.readFileSync(file, "utf8");
    const r = scaffold(root, "team", { ...TEAM, mission: "Other." });
    assert.equal(r.status, 1);
    const e = env(r);
    assert.equal(e.ok, false);
    assert.equal(e.findings[0]?.rule, "target-exists");
    assert.equal(fs.readFileSync(file, "utf8"), before);
    assert.equal(scaffold(root, "team", { ...TEAM, mission: "Other." }, ["--force"]).status, 0);
    assert.match(fs.readFileSync(file, "utf8"), /Other\./);
  });

  test("--dry-run writes nothing and returns the content", () => {
    const root = fresh();
    const r = scaffold(root, "expertise", EXPERTISE, ["--dry-run"]);
    assert.equal(r.status, 0);
    const e = env(r);
    assert.equal(e.data?.["written"], false);
    assert.match(String(e.data?.["content"]), /^# Data Engineer/);
    assert.equal(fs.existsSync(path.join(root, "config")), false);
  });

  test("invalid answers exit 1 with stable rules; usage and precondition errors exit 2 and 3", () => {
    const root = fresh();
    const missing = scaffold(root, "team", { name: "X", mission: "m" });
    assert.equal(missing.status, 1);
    assert.ok(env(missing).findings.some((f) => f.rule === "answers-missing"));
    const heading = scaffold(root, "team", { ...TEAM, mission: "ok\n## Injected" });
    assert.ok(env(heading).findings.some((f) => f.rule === "answers-heading"));
    assert.equal(scaffold(root, "expertise", { ...EXPERTISE, shape: "x" }).status, 1);
    assert.equal(
      env(scaffold(root, "team", { ...TEAM, name: "!!!" })).findings[0]?.rule,
      "bad-name",
    );
    const usage = node(SCAFFOLD, ["--kind", "nope", "--json"]);
    assert.equal(usage.status, 2);
    assert.equal(env(usage).findings[0]?.rule, "usage");
    assert.equal(node(SCAFFOLD, ["--kind", "soul", "--name", "x"]).status, 2);
    assert.equal(node(SCAFFOLD, ["--kind", "team", "--bogus"]).status, 2);
    const pre = node(SCAFFOLD, [
      "--kind",
      "team",
      "--name",
      "A",
      "--root",
      path.join(root, "absent"),
      "--json",
    ]);
    assert.equal(pre.status, 3);
    assert.equal(env(pre).data, null);
  });
});

describe("lint-config-file", () => {
  const lintText = (kind: string, text: string): Env => {
    const f = path.join(tmp, `lint-${n++}.md`);
    fs.writeFileSync(f, text);
    return env(lint(kind, f));
  };
  test("rules fire on a broken file of each kind", () => {
    const team = lintText("team", "# Atlas\n\n## Technology Stack\n\n- x\n\n## Mission\n\nTODO\n");
    for (const rule of ["title", "section-missing", "section-order", "placeholder"])
      assert.ok(
        team.findings.some((f) => f.rule === rule),
        rule,
      );
    const exp = lintText(
      "expertise",
      "# R\n\n## Stack\n\n- a\n\n## Responsibilities\n\n- b\n\n## Key Practices\n\nnone\n",
    );
    for (const rule of ["summary-missing", "shape-conflict", "no-bullets"])
      assert.ok(
        exp.findings.some((f) => f.rule === rule),
        rule,
      );
    assert.ok(
      lintText("soul", "# SOUL.md\n\n## S - Stance\n\ntext\n").findings.some(
        (f) => f.rule === "section-missing",
      ),
    );
    assert.ok(
      lintText(
        "team",
        "# Team A\n\n## Mission\n\nm\n\n## Technology Stack\n\n- s\n\n## Development Practices\n\n- p\n\n## Extra\n\nx\n",
      ).findings.some((f) => f.severity === "warning"),
    );
  });
  test("the unmodified profile template does not pass", () => {
    const r = lint("profile", path.join(REPO, "config", "PROFILE.md.template"));
    assert.equal(r.status, 1);
    assert.ok(env(r).findings.some((f) => f.rule === "placeholder"));
  });
  test("the shipped catalog and the soul template lint clean", () => {
    for (const [kind, dir] of [
      ["team", "teams"],
      ["expertise", "expertise"],
    ] as const)
      for (const f of fs.readdirSync(path.join(REPO, "config", dir)))
        assert.equal(lint(kind, path.join(REPO, "config", dir, f)).status, 0, f);
    assert.equal(lint("soul", path.join(REPO, "config", "SOUL.md.template")).status, 0);
  });
  test("missing file exits 3, no file exits 2", () => {
    assert.equal(lint("team", path.join(tmp, "absent.md")).status, 3);
    assert.equal(node(LINT, ["--kind", "team"]).status, 2);
  });
});

describe("copies", () => {
  test("init-expertise carries byte-identical copies of the scripts", () => {
    for (const s of ["scaffold-config-file.ts", "lint-config-file.ts"])
      assert.deepEqual(
        fs.readFileSync(path.join(SKILLS, "init-expertise", "scripts", s)),
        fs.readFileSync(path.join(SKILLS, "init-team", "scripts", s)),
      );
  });
});
