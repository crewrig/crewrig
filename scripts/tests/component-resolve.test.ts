// component-resolve.test.ts — unit suite for scripts/lib/component-resolve.ts (spec 0250 R17).
//
// The shell is the oracle (R14); where it disagrees with R17's prose the SHELL is pinned:
//   - display name: `basename` keeps `claude:mcpServers.foo` whole, so the prefix comes off
//     only when the target string itself starts with it (a skill named `mcpServers.foo`);
//     R17's sentence reads as if it always came off (a spec/shell gap, named at the rows);
//   - declared name: raw bytes, so a CRLF or BOM source falls back to the directory name.
// Trees live under the OS temp dir. A small parity set runs the shell (LC_ALL=C) on Linux.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  componentDeclaredName,
  componentEmitTarget,
  componentTargetDisplayName,
  installedTargets,
  reportCollision,
  reportInstalledNameCollisions,
  targetRecordLine,
} from "../lib/component-resolve.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const BOM = String.fromCharCode(0xfeff);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "component-resolve-test-"));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const content = (op = ""): string =>
  op === "@@" ? "---\nd: x\n---\n" : op.startsWith("@") ? named(op.slice(1)) : "x";
/** A tree under a fresh root: `path [@name|@@|-> target]` (`@name` and `@@`: frontmatter with and
 * without a name, else `x`), `dir/`; entries split at a line feed or `;`. */
function build(spec: string): string {
  const root = fs.mkdtempSync(path.join(tmp, "t"));
  for (const line of spec.split(/[\n;]/).filter((l) => l.trim() !== "")) {
    const [rel = "", op, arg = ""] = line.trim().split(/\s+/);
    const file = path.join(root, rel);
    fs.mkdirSync(rel.endsWith("/") ? file : path.dirname(file), { recursive: true });
    if (op === "->") fs.symlinkSync(arg, file);
    else if (!rel.endsWith("/")) fs.writeFileSync(file, content(op));
  }
  return root;
}
const named = (name: string): string => `---\nname: ${name}\n---\n`;
const fileWith = (text: string): string => {
  const file = path.join(build("f/"), "f.md");
  fs.writeFileSync(file, text);
  return file;
};
const records = (a: string): string => installedTargets(a).map(targetRecordLine).join("");
function report(artifacts: string): { status: number; text: string; chunks: number } {
  const got = { status: 0, text: "", chunks: 0 };
  const sink = (t: string): number => ((got.text += t), (got.chunks += 1));
  got.status = reportInstalledNameCollisions(artifacts, sink);
  return got;
}
const refused = (a: string): (string | undefined)[] =>
  [...report(a).text.matchAll(/^Refusing '(.*?)'/gm)].map((m) => m[1]);

const noShell =
  process.platform === "linux" || process.env["CREWRIG_SHELL_PARITY"] === "1"
    ? undefined
    : "skipped: needs Linux with bash";
function sh(body: string, ...args: string[]): { out: string; err: string; status: number | null } {
  const script = `. "${REPO}/scripts/lib/component-resolve.sh"; ${body}`;
  const env = { ...process.env, LC_ALL: "C" };
  const r = spawnSync("bash", ["-c", script, "x", ...args], { encoding: "utf8", env });
  return { out: r.stdout, err: r.stderr, status: r.status };
}

// label, whole file text, the name the shell read (FB: the fallback)
const nameRows: readonly (readonly [string, string, string])[] = [
  ["plain", named("foo"), "foo"],
  ["double-quoted", named('"foo"'), "foo"],
  ["double inside single keeps the double", named("'\"foo\"'"), '"foo"'],
  ["single inside double loses both", named("\"'foo'\""), "foo"],
  ["a trailing comment is part of the name", named("probe # note"), "probe # note"],
  ["quoted name then a comment keeps one quote", named('"probe" # note'), 'probe" # note'],
  ["blanks after a quoted name hide its quote", named('"foo"  '), 'foo"'],
  ["tab after the colon and at the end", "---\nname:\t foo\t\n---\n", "foo"],
  ["no blank after the colon", "---\nname:foo\n---\n", "foo"],
  ["empty name", "---\nname:\n---\n", "FB"],
  ["empty quoted name", named('""'), "FB"],
  ["a carriage return inside the name is removed", "---\nname: a\rb\n---\n", "ab"],
  ["duplicate name: the first wins", "---\nname: a\nname: b\n---\n", "a"],
  ["an indented name is not a name", "---\n  name: a\n---\n", "FB"],
  ["a nested name does not shadow the top one", "---\nm:\n  name: a\nname: b\n---\n", "b"],
  ["name after the closing fence", "---\nd: x\n---\nname: a\n", "FB"],
  ["no frontmatter", "name: a\n", "FB"],
  ["fences followed by blanks open and close", "---  \nname: a\n---\t\n", "a"],
  ["CRLF whole file: no fence on line 1", "---\r\nname: crlf\r\n---\r\n", "FB"],
  ["CRLF on the name line only: closing quote kept", '---\nname: "c"\r\n---\n', 'c"'],
  ["CRLF on a plain name line is removed", "---\nname: crlf\r\n---\n", "crlf"],
  ["mixed: LF opening fence, CRLF after", "---\nname: m\r\n---\r\n", "m"],
  ["mixed: CRLF opening fence hides the name", "---\r\nname: m\n---\n", "FB"],
  ["a byte-order mark hides the opening fence", `${BOM}---\nname: bom\n---\n`, "FB"],
];

describe("componentDeclaredName (R17: the line-based rule)", () => {
  for (const [label, text, want] of nameRows)
    test(label, () => assert.equal(componentDeclaredName(fileWith(text), "FB"), want));
  test("a missing file and a directory fall back; a symlinked file is read through", () => {
    const real = build("real.md @linked\nd/");
    const link = build(`l.md -> ${path.join(real, "real.md")}`);
    assert.equal(componentDeclaredName(path.join(real, "nope.md"), "FB"), "FB");
    assert.equal(componentDeclaredName(path.join(real, "d"), "FB"), "FB");
    assert.equal(componentDeclaredName(path.join(link, "l.md"), "FB"), "linked");
  });
});

describe("componentTargetDisplayName", () => {
  const rows: readonly (readonly [string, string])[] = [
    [".claude/skills/foo", "foo"],
    [".gemini/commands/foo.toml", "foo"],
    ["claude:rules/p.md", "p"],
    ["a.md.toml", "a.md"],
    ["x.toml.md", "x"],
    ["foo.json.json", "foo.json"],
    // Spec/shell gap: the shell keeps these whole (R17's prose says they are stripped).
    ["claude:mcpServers.foo", "claude:mcpServers.foo"],
    ["gemini:settings.themes.t", "gemini:settings.themes.t"],
    [".claude/skills/mcpServers.foo", "foo"],
    [".claude/skills/settings.themes.q.json", "q"],
  ];
  test("each target string", () => {
    for (const [target, want] of rows)
      assert.equal(componentTargetDisplayName(target), want, target);
  });
});

describe("reportCollision and targetRecordLine", () => {
  const header = (n: string): string =>
    `Refusing '${n}': one installed name is claimed by more than one component.\n` +
    "Every source presenting it, in no significant order:\n";
  test("two-line header and one line per source, byte for byte, in one write", () => {
    const chunks: string[] = [];
    reportCollision("n'q", ["a", "tier 'x' declares"], (t) => chunks.push(t));
    assert.deepEqual(chunks, [`${header("n'q")}  - a\n  - tier 'x' declares\n`]);
  });
  test("no source leaves the header alone; the default sink is standard error", (t) => {
    const write = t.mock.method(process.stderr, "write", () => true);
    reportCollision("n", []);
    assert.equal(write.mock.calls[0]?.arguments[0], header("n"));
    assert.equal(write.mock.calls.length, 1);
  });
  test("a record is four tab-separated fields and a line feed", () => {
    const record = componentEmitTarget("core", "t", "tier", "skills");
    assert.equal(targetRecordLine(record), "core\tt\ttier\tskills\n");
  });
});

const CLI4 = (p: string): string =>
  [".claude", ".gemini", ".github", ".agents"].map((r) => `${r}/${p}`).join(" ");
/** The records grouped by kind, as `kind: targets...` (a group per run of one kind). */
function grouped(a: string): string[] {
  const out: string[] = [];
  for (const r of installedTargets(a)) {
    const last = out[out.length - 1];
    if (last?.startsWith(`${r.kind}:`) === true) out[out.length - 1] = `${last} ${r.installTarget}`;
    else out.push(`${r.kind}: ${r.installTarget}`);
  }
  return out;
}

describe("installedTargets on throwaway trees", () => {
  test("every kind in the R17 order; hidden and malformed entries are skipped", () => {
    const a = build(`
      core/skills/s/SKILL.md @s; core/skills/nofile/; core/skills/loose.md
      core/commands/c.md @c; core/commands/dir.md/x; core/commands/.hid.md; core/commands/note.txt
      core/agents/g/AGENT.md @@; core/agents/empty/
      core/policies/p.md; core/policies/.gitkeep; core/policies/broken -> ${tmp}/nowhere
      core/hooks/h.json; core/hooks/.gitkeep; core/themes/t.json; core/themes/t.txt
      core/mcp-servers/m.json; .hidden/skills/z/SKILL.md @z; plainfile
    `);
    assert.deepEqual(grouped(a), [
      `skills: ${CLI4("skills/s")}`,
      "commands: .claude/skills/c .gemini/commands/c.toml .github/skills/c .agents/skills/c",
      "agents: .claude/agents/g.md .gemini/agents/g.md .github/agents/g.md .agents/agents/g",
      "policies: claude:rules/p.md gemini:policies/p.md antigravity:rules/p.md",
      "hooks: gemini:hooks/h.json",
      "themes: gemini:settings.themes.t",
      "mcp-servers: claude:mcpServers.m gemini:mcpServers.m copilot:mcpServers.m antigravity:mcpServers.m",
    ]);
  });
  test("tier class, and code-unit order of tiers and of entries within a kind", () => {
    const a = build(`
      library/skills/s/SKILL.md @s; core/skills/s/SKILL.md @s; alpha/skills/b/SKILL.md @b
      Zeta/skills/B/SKILL.md @B; Zeta/skills/a/SKILL.md @a; _us/skills/u/SKILL.md @u
    `);
    const claude = installedTargets(a).filter((r) => r.installTarget.startsWith(".claude/"));
    const got = claude.map((r) => `${r.tierClass}:${r.tier}:${r.installTarget.slice(15)}`);
    const want =
      "overlay:Zeta:B overlay:Zeta:a overlay:_us:u overlay:alpha:b core:core:s overlay:library:s";
    assert.equal(got.join(" "), want);
  });
  test("the name comes from the declaration; a symlinked skill directory is followed", () => {
    const outside = build("linked/SKILL.md @lk");
    const a = build(`core/skills/dir/SKILL.md @other\ncore/skills/ln -> ${outside}/linked`);
    assert.deepEqual(grouped(a), [`skills: ${CLI4("skills/other")} ${CLI4("skills/lk")}`]);
  });
  test("a missing, empty or file-only artifacts directory has no record", () => {
    assert.deepEqual(installedTargets(path.join(tmp, "absent")), []);
    for (const spec of ["a/", "a/file"]) assert.deepEqual(installedTargets(`${build(spec)}/a`), []);
  });
});

describe("installedTargets on the real artifacts/ tree", () => {
  const dir = path.join(REPO, "artifacts");
  const all = installedTargets(dir);
  const kinds = ["skills", "commands", "agents", "policies", "hooks", "themes", "mcp-servers"];
  const count = (pattern: string): number => fs.globSync(pattern, { cwd: dir }).length;
  test("record counts per kind follow the tree, and nothing collides", () => {
    const per = kinds.map((k) => all.filter((r) => r.kind === k).length);
    const globs =
      "*/skills/*/SKILL.md */commands/*.md */agents/*/AGENT.md */policies/* */hooks/* */themes/*.json */mcp-servers/*.json";
    const weight = [4, 4, 4, 3, 1, 1, 4];
    const want = globs.split(" ").map((g, i) => count(g) * (weight[i] ?? 0));
    assert.deepEqual(report(dir), { status: 0, text: "", chunks: 0 });
    assert.deepEqual(per, want);
  });
  test("tiers in code-unit order, kinds in the R17 order, class core only for core", () => {
    const keys = all.map((r) => `${r.tier}\u0000${kinds.indexOf(r.kind)}`);
    assert.deepEqual(keys, [...keys].sort());
    assert.ok(all.every((r) => (r.tierClass === "core") === (r.tier === "core")));
  });
});

describe("reportInstalledNameCollisions", () => {
  test("a clean tree is silent and returns 0, core against an overlay tier included", () => {
    const a = build(
      "core/skills/s/SKILL.md @s; library/skills/s/SKILL.md @s; core/agents/s/AGENT.md @s",
    );
    assert.deepEqual(report(a), { status: 0, text: "", chunks: 0 });
  });
  test("a command and a skill collide in the three shared skill namespaces, sorted, sources in tier order", () => {
    const a = build(
      "library/skills/a/SKILL.md @dup; community/commands/dup.md @dup; org/agents/x/AGENT.md @dup",
    );
    const line = (tier: string, kind: string, t: string): string =>
      `  - tier '${tier}' declares a ${kind} component installing to ${t}\n`;
    const block = (t: string): string =>
      "Refusing 'dup': one installed name is claimed by more than one component.\n" +
      `Every source presenting it, in no significant order:\n${line("community", "commands", t)}${line("library", "skills", t)}`;
    const want = [".agents", ".claude", ".github"].map((r) => block(`${r}/skills/dup`)).join("");
    assert.deepEqual(report(a), { status: 1, text: want, chunks: 3 });
  });
  test("two components of core collide; the key order is code-unit, not locale", () => {
    const a = build(
      "core/skills/1/SKILL.md @abc; core/skills/2/SKILL.md @abc; core/skills/3/SKILL.md @Zed; core/skills/4/SKILL.md @Zed",
    );
    assert.equal(refused(a).join(" "), "Zed abc Zed abc Zed abc Zed abc");
  });
  test("themes, policies, hooks and mcp-servers collide per target; display names are the shell's", () => {
    const entries = ["themes/th.json", "mcp-servers/srv.json", "policies/pol.md", "hooks/hk.sh"];
    const a = build(["library", "org"].flatMap((t) => entries.map((e) => `${t}/${e}`)).join("\n"));
    const want =
      "antigravity:mcpServers.srv pol claude:mcpServers.srv pol copilot:mcpServers.srv hk.sh gemini:mcpServers.srv pol gemini:settings.themes.th";
    assert.equal(refused(a).join(" "), want);
  });
});

describe("parity with the shell library (LC_ALL=C)", { skip: noShell }, () => {
  const collide = build(`
    library/skills/a/SKILL.md @dup; community/commands/dup.md @dup; org/skills/b/SKILL.md @dup
    core/skills/c/SKILL.md @dup; core/skills/d/SKILL.md @dup; library/themes/th.json; org/themes/th.json
    library/mcp-servers/s.json; org/mcp-servers/s.json; library/policies/p.md; org/policies/p.md
    org/skills/e/SKILL.md @Zed; library/skills/f/SKILL.md @Zed
    library/skills/g/SKILL.md @mcpServers.foo; org/skills/h/SKILL.md @mcpServers.foo
  `);
  test("records, collision report and status: the real tree, a collision tree, empty and absent", () => {
    const [real, empty] = [path.join(REPO, "artifacts"), `${build("a/")}/a`];
    const trees = [real, collide, empty, path.join(tmp, "absent")];
    for (const dir of trees) {
      assert.equal(records(dir), sh('installed_targets "$1"', dir).out, dir);
      const shell = sh('report_installed_name_collisions "$1"', dir);
      const ts = report(dir);
      assert.deepEqual([ts.text, ts.status], [shell.err, shell.status], dir);
    }
  });
  test("every declared-name row above, and display names", () => {
    for (const [label, text] of nameRows) {
      const file = fileWith(text);
      const shell = sh('printf "%s" "$(_component_declared_name "$1" "$2")"', file, "FB").out;
      assert.equal(componentDeclaredName(file, "FB"), shell, label);
    }
    const display = 'printf "%s" "$(_component_target_display_name "$1")"';
    for (const t of ".claude/skills/mcpServers.foo claude:mcpServers.foo x.toml.md".split(" "))
      assert.equal(componentTargetDisplayName(t), sh(display, t).out, t);
  });
  test("report_collision and the record line", () => {
    let ts = "";
    reportCollision("n'q", ["a", "tier 'x' declares"], (t) => (ts += t));
    assert.equal(ts, sh('report_collision "$@"', "n'q", "a", "tier 'x' declares").err);
    const line = targetRecordLine(componentEmitTarget("core", "t", "tier", "skills"));
    assert.equal(line, sh('_component_emit_target "$@"', "core", "t", "tier", "skills").out);
  });
});
