// build-components-conformance-render.test.ts — the command renderer and the collision
// pre-pass of the shell/TypeScript conformance (spec 0250 R21, requirements 17 and 18).
// Linux only, spawning `bash` and `yq`; it retires with the shell libraries (rows F2, G1b).
//
// Renderer: for every command source of `artifacts/`, `extensions/core/hello-world/` and the
// synthetic commands `test-build-extension.sh` renders (one carrying provenance, one plain),
// the three extraction helpers, two field reads, the TOML provenance comment and the Gemini
// and Claude forms are compared with the shell's. The shell's `render_command_toml_provenance_comment`
// prints a trailing line feed that every shell caller strips with `$(...)`, so it is compared
// as captured; the Gemini and Claude strings are compared raw (they carry none, R18).
// Pre-pass: `installed_targets` records, and `report_installed_name_collisions` standard
// error and status, over the real tree, the overlay fixture and synthetic trees.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import {
  installedTargets,
  reportInstalledNameCollisions,
  targetRecordLine,
} from "../lib/component-resolve.ts";
import { createRenderCommand, extractBody, extractFrontmatter } from "../lib/render-command.ts";
import { fields, parityGate, REPO, runBash, sh } from "./lib/shell-resolve-harness.ts";
import { yamlText } from "./lib/yaml-lib.ts";

const skip = parityGate();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "conformance-render-"));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const write = (rel: string, text = "x"): string => {
  const file = path.join(tmp, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return file;
};

const RENDER_DRIVER = sh`
. "$1/scripts/lib/render-command.sh"; shift
for f in "$@"; do
  fm=$(extract_frontmatter "$f")
  g=$(render_command_gemini "$f"; printf x); c=$(render_command_claude "$f"; printf x)
  printf '%s\0' "$fm" "$(extract_body "$f")" "$(yaml_field "$f" name)" "$(yaml_field "$f" description)" \
    "$(render_command_toml_provenance_comment "$fm")" "%{g%x}" "%{c%x}"
done
`;
const RENDER_FIELDS = [
  "frontmatter",
  "body",
  "name",
  "description",
  "tomlComment",
  "gemini",
  "claude",
];

async function shellRender(sources: readonly string[]): Promise<string[][]> {
  const f = fields(await runBash(RENDER_DRIVER, [REPO, ...sources]));
  return sources.map((_, i) => f.slice(i * RENDER_FIELDS.length, (i + 1) * RENDER_FIELDS.length));
}
function twinRender(source: string): string[] {
  const r = createRenderCommand(yamlText);
  const fm = extractFrontmatter(source);
  const named = [r.yamlField(source, "name"), r.yamlField(source, "description")];
  const forms = [
    r.renderCommandTomlProvenanceComment(fm),
    r.renderCommandGemini(source),
    r.renderCommandClaude(source),
  ];
  return [fm, extractBody(source), ...named, ...forms];
}

const COLLISION_DRIVER = sh`
export REPO_DIR="$1"; . "$1/scripts/lib/component-resolve.sh"; shift
for d in "$@"; do
  records=$(installed_targets "$d"; printf x); err=$(report_installed_name_collisions "$d" 2>&1 >/dev/null; printf x)
  report_installed_name_collisions "$d" 2>/dev/null; st=$?
  printf '%s\0' "%{records%x}" "%{err%x}" "$st"
done
`;
interface CollisionReport {
  records: string;
  stderr: string;
  status: number;
}
async function shellCollisions(dirs: readonly string[]): Promise<CollisionReport[]> {
  const f = fields(await runBash(COLLISION_DRIVER, [REPO, ...dirs]));
  return dirs.map((_, i) => ({
    records: f[3 * i] ?? "",
    stderr: f[3 * i + 1] ?? "",
    status: Number(f[3 * i + 2]),
  }));
}
function twinCollisions(artifactsDir: string): CollisionReport {
  let stderr = "";
  const status = reportInstalledNameCollisions(artifactsDir, (t) => void (stderr += t));
  return { records: installedTargets(artifactsDir).map(targetRecordLine).join(""), stderr, status };
}

const ext = path.join(REPO, "extensions", "core", "hello-world", "commands", "hello.md");
const provenance = `---\nname: x\ndescription: "Synthetic command carrying provenance"\ntype: command\nmetadata:\n  provenance:\n    version: "1.0.0"\n    canonical: "https://example.com/owner/repo"\n    feedback: "https://example.com/owner/repo"\n---\n\nDo the synthetic thing.\n`;
const synthetic = [
  write("syn/x.md", provenance),
  write(
    "syn/y.md",
    `---\nname: y\ndescription: "Plain command, no provenance"\ntype: command\n---\n\nJust a plain prompt.\n`,
  ),
  write(
    "syn/tools.md",
    `---\nname: t\ndescription: >\n  folded\n  text\nclaude:\n  allowed-tools:\n    - Read\n    - Bash(git *)\n---\nA body\n\n\`\`\`\n---\nnested: yes\n---\n\`\`\`\nend`,
  ),
  write(
    "syn/numbers.md",
    `---\nname: 1.0\ndescription: True\nmetadata:\n  provenance:\n    version: 0\n    canonical: false\n---\nbody\n`,
  ),
];
const sources = [
  ...fs
    .globSync("artifacts/*/commands/*.md", { cwd: REPO })
    .sort()
    .map((r) => path.join(REPO, r)),
  ext,
  ...synthetic,
];

/** A tree under `tmp`: `path` lines, `name` content, `-> target` skipped (the shell and twin share one reader). */
function tree(name: string, entries: Record<string, string>): string {
  for (const [rel, text] of Object.entries(entries)) write(`${name}/artifacts/${rel}`, text);
  return path.join(tmp, name, "artifacts");
}
const named = (n: string): string => `---\nname: ${n}\n---\n`;
const collide = tree("collide", {
  "library/skills/a/SKILL.md": named("dup"),
  "org/skills/b/SKILL.md": named("dup"),
  "community/commands/dup.md": named("dup"),
  "org/agents/x/AGENT.md": named("dup"),
  "core/skills/dup/SKILL.md": named("dup"),
  "core/skills/dup2/SKILL.md": named("dup"),
  "library/themes/th.json": "{}",
  "org/themes/th.json": "{}",
  "library/mcp-servers/srv.json": "{}",
  "org/mcp-servers/srv.json": "{}",
  "community/mcp-servers/srv.json": "{}",
  "library/policies/pol.md": "p",
  "org/policies/pol.md": "p",
  "library/hooks/hk.sh": "h",
  "org/hooks/hk.sh": "h",
  "library/skills/q1/SKILL.md": named('"quoted"'),
  "org/skills/q2/SKILL.md": named("quoted"),
  "library/skills/s1/SKILL.md": named("x/y"),
  "org/skills/s2/SKILL.md": named("x/y"),
  "library/skills/d1/SKILL.md": named("a.md"),
  "org/skills/d2/SKILL.md": named("a.md"),
  "library/skills/m1/SKILL.md": named("mcpServers.foo"),
  "org/skills/m2/SKILL.md": named("mcpServers.foo"),
});
const clean = tree("clean", {
  "core/skills/s1/SKILL.md": named("s1"),
  "core/agents/s1/AGENT.md": named("s1"),
  "library/skills/s1/SKILL.md": named("s1"),
  "core/commands/c.md": named("c"),
  "core/policies/p.md": "p",
  "core/policies/.gitkeep": "",
  "core/hooks/h.json": "{}",
  "core/themes/t.json": "{}",
  "core/mcp-servers/m.json": "{}",
  ".hidden/skills/z/SKILL.md": named("z"),
  plainfile: "x",
  "library/commands/noname.md": "no frontmatter\n",
  "library/commands/bad.txt": "x",
  "UPPER/skills/Zeta/SKILL.md": named("Zeta"),
  "UPPER/skills/alpha/SKILL.md": named("alpha"),
  "UPPER/skills/_us/SKILL.md": named("_us"),
});
const empty = tree("empty", {});
fs.mkdirSync(empty, { recursive: true });
const trees = {
  "real artifacts/": path.join(REPO, "artifacts"),
  "overlay fixture": path.join(REPO, "tests", "fixtures", "overlay", "artifacts"),
  "synthetic collisions": collide,
  "synthetic clean tree": clean,
  "empty tree": empty,
  "missing directory": path.join(tmp, "absent"),
};

const [shellStrings, shellReports] =
  skip === undefined
    ? await Promise.all([shellRender(sources), shellCollisions(Object.values(trees))])
    : [[], []];

describe(
  "renderer and collision pre-pass: the shell libraries and their twins agree",
  skip === undefined ? {} : { skip },
  () => {
    sources.forEach((source, i) => {
      test(`render ${source.startsWith(REPO) ? path.relative(REPO, source) : `synthetic ${path.basename(source)}`}`, () => {
        const [shell, twin] = [shellStrings[i] as string[], twinRender(source)];
        assert.deepEqual(
          RENDER_FIELDS.map((f, k) => [f, twin[k]]),
          RENDER_FIELDS.map((f, k) => [f, shell[k]]),
        );
      });
    });

    test("the renderer corpus is not vacuous", (t) => {
      assert.ok(sources.length >= 7, `${sources.length} sources`);
      const all = shellStrings.flat();
      assert.ok(
        shellStrings.some((s) => (s[4] ?? "").startsWith("# crewrig-provenance:")),
        "a provenance comment",
      );
      assert.ok(
        shellStrings.some((s) => (s[6] ?? "").includes("allowed-tools:")),
        "an allowed-tools list",
      );
      assert.ok(
        shellStrings.every((s) => !(s[5] ?? "").endsWith("\n") && !(s[6] ?? "").endsWith("\n")),
      );
      assert.ok(
        shellStrings.some((s) => (s[5] ?? "").startsWith("# crewrig-provenance:")),
        "provenance above description",
      );
      t.diagnostic(`${sources.length} sources, ${all.length} strings compared`);
    });

    Object.entries(trees).forEach(([label, dir], i) => {
      test(`pre-pass over ${label}`, () => {
        const [shell, twin] = [shellReports[i] as CollisionReport, twinCollisions(dir)];
        assert.deepEqual(twin, shell);
      });
    });

    test("the pre-pass corpus is not vacuous, and the display name pins the shell", () => {
      const by = (label: string): CollisionReport =>
        shellReports[Object.keys(trees).indexOf(label)] as CollisionReport;
      assert.equal(by("real artifacts/").status, 0);
      assert.ok(
        by("real artifacts/").records.split("\n").length >= 100,
        "the real tree has many targets",
      );
      assert.ok(by("overlay fixture").records !== "" && by("synthetic clean tree").status === 0);
      assert.equal(by("synthetic collisions").status, 1);
      const refusals = [...by("synthetic collisions").stderr.matchAll(/^Refusing '(.*)'/gm)].map(
        (m) => m[1],
      );
      assert.ok(refusals.length >= 15, `${refusals.length} refusals`);
      // R17 prose says the `mcpServers.` prefix comes off; the shell's `basename` keeps `claude:mcpServers.srv` whole.
      assert.ok(
        refusals.includes("claude:mcpServers.srv") && refusals.includes("foo"),
        `${refusals}`,
      );
      assert.ok(by("empty tree").records === "" && by("missing directory").records === "");
    });
  },
);
