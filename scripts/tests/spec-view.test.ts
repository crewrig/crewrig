// spec-view.test.ts — spec 0273 R1-R7: the read-only effective view, against
// throwaway git repositories created under mkdtemp (nothing else is ever removed).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadTaskfileTree, taskCmds } from "../lib/taskfile-tree.ts";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLI = path.join(REPO, "scripts", "spec-view.ts");
const TMP = mkdtempSync(path.join(tmpdir(), "spec-view-"));
after(() => rmSync(TMP, { recursive: true, force: true }));

let n = 0;
function fixture(files: Record<string, string>): string {
  const root = path.join(TMP, `fx${n++}`);
  mkdirSync(path.join(root, "specs"), { recursive: true });
  spawnSync("git", ["init", "-q"], { cwd: root });
  for (const [rel, text] of Object.entries(files)) writeFileSync(path.join(root, rel), text);
  return root;
}

function view(root: string, id: string) {
  const env = { ...process.env };
  delete env.CREWRIG_REPO_DIR;
  const r = spawnSync(
    process.execPath,
    ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", CLI, id],
    { cwd: root, env, encoding: "utf8" },
  );
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

const fm = (id: string, version: string) =>
  `---\nid: "${id}"\nslug: demo\nstatus: approved\nversion: ${version}\n---\n`;
const BASE_BODY =
  "\n# Demo\n\n## Intent\n\nBase  text with trailing spaces  \nand no final newline";
const delta = (id: string, v: string, mod: string) =>
  `${fm(id, v)}\n# Demo (delta)\n\n## ADDED\n\nadded ${v}\n\n## MODIFIED\n\n${mod}\n\n## REMOVED\n\nnone\n`;

function tree(root: string): string {
  const h = createHash("sha256");
  for (const f of readdirSync(path.join(root, "specs")).sort()) {
    h.update(f).update(readFileSync(path.join(root, "specs", f)));
  }
  return h.digest("hex");
}

const two = () =>
  fixture({
    "specs/0002-demo.md": fm("0002", "1.0.0") + BASE_BODY,
    "specs/0002-demo.delta-02.md": delta("0002", "1.2.0", "> was: a\n> now: c"),
    "specs/0002-demo.delta-01.md": delta("0002", "1.1.0", "> was: a\n> now: b"),
    "specs/0003-other.delta-01.md": delta("0003", "9.9.9", "other"),
  });

describe("spec view (spec 0273)", () => {
  test("two deltas: header, base body, Delta 01 then Delta 02, cumulative version, no file change", () => {
    const root = two();
    const before = tree(root);
    const r = view(root, "0002");
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stderr, "");
    assert.match(r.stdout, /Cumulative version: 1\.2\.0/);
    assert.ok(r.stdout.indexOf("Delta 01") < r.stdout.indexOf("Delta 02"));
    assert.ok(
      r.stdout.indexOf("specs/0002-demo.delta-01.md") <
        r.stdout.indexOf("specs/0002-demo.delta-02.md"),
    );
    assert.ok(!r.stdout.includes("9.9.9"));
    assert.equal(tree(root), before);
  });

  test("base body is byte-identical and deltas are verbatim, no marker or Unresolved", () => {
    const root = two();
    const r = view(root, "2");
    assert.ok(r.stdout.includes(BASE_BODY));
    assert.ok(r.stdout.includes("> was: a\n> now: b"));
    assert.ok(
      r.stdout.includes(
        "## ADDED\n\nadded 1.2.0\n\n## MODIFIED\n\n> was: a\n> now: c\n\n## REMOVED",
      ),
    );
    assert.doesNotMatch(r.stdout, /Unresolved|\[MODIFIED\]|\[REMOVED\]|<!--/);
    assert.ok(!r.stdout.includes('id: "0002"'));
  });

  test("CRLF frontmatter is split and the body kept raw", () => {
    const body = "\r\n# Demo\r\n\r\ntext\r\n";
    const root = fixture({
      "specs/0004-crlf.md": `---\r\nid: "0004"\r\nversion: 2.0.0\r\n---\r\n${body}`,
    });
    const r = view(root, "4");
    assert.equal(r.status, 0, r.stderr);
    assert.ok(r.stdout.includes(body));
    assert.match(r.stdout, /Cumulative version: 2\.0\.0/);
  });

  test("unknown id: empty stdout, id on stderr, non-zero exit", () => {
    const r = view(two(), "9999");
    assert.equal(r.stdout, "");
    assert.match(r.stderr, /9999/);
    assert.notEqual(r.status, 0);
  });

  test("spec without delta states so and exits 0", () => {
    const root = fixture({ "specs/0005-solo.md": fm("0005", "1.0.0") + BASE_BODY });
    const r = view(root, "0005");
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /no deltas/);
    assert.match(r.stdout, /Cumulative version: 1\.0\.0/);
    assert.ok(r.stdout.includes(BASE_BODY));
    assert.doesNotMatch(r.stdout, /## Delta/);
  });

  test("padded and unpadded ids give identical output", () => {
    const root = two();
    assert.equal(view(root, "2").stdout, view(root, "0002").stdout);
  });

  test("deterministic, no absolute path", () => {
    const root = two();
    const a = view(root, "2").stdout;
    assert.equal(a, view(root, "2").stdout);
    assert.ok(!a.includes(root) && !a.includes(TMP));
  });

  test("Taskfile entry runs the floor guard then the script", () => {
    const cmds = taskCmds(loadTaskfileTree(REPO), "spec:view");
    assert.ok(cmds.length > 0, "spec:view entry missing");
    const guard = cmds.findIndex((c) => c.includes("node-floor-guard.js"));
    const script = cmds.findIndex((c) => c.includes("scripts/spec-view.ts"));
    assert.ok(guard >= 0 && guard < script);
    assert.match(cmds[script] ?? "", /\{\{\.CLI_ARGS\}\}/);
  });
});
