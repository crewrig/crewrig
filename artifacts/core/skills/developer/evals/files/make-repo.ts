// Builds ./repo, a throwaway local repository for the developer evals: no remote, no hook,
// no signing, one commit. Usage: node make-repo.ts <slugify|handoff|rename|paginate>   (Node.js 24, no import)

void (() => {
  const fs = process.getBuiltinModule("node:fs");
  const cp = process.getBuiltinModule("node:child_process");
  const scenario = process.argv[2] ?? "";
  const repo = "repo";

  const git = (...args: string[]): void => {
    const r = cp.spawnSync("git", args, { cwd: repo, stdio: ["ignore", "ignore", "inherit"] });
    if (r.status !== 0) {
      process.stderr.write(`make-repo: git ${args.join(" ")} failed\n`);
      process.exit(1);
    }
  };
  const put = (file: string, body: string, mode?: number): void => {
    const path = `${repo}/${file}`;
    fs.mkdirSync(path.slice(0, path.lastIndexOf("/")), { recursive: true });
    fs.writeFileSync(path, body);
    if (mode !== undefined) fs.chmodSync(path, mode);
  };

  const files: Record<string, Record<string, string>> = {
    slugify: {
      "src/slugify.js":
        'export function slugify(text) {\n  return text.toLowerCase().replace(/[^a-z0-9]/g, "-");\n}\n',
      "src/format.js":
        "// legacy formatting helpers, kept as they are\n" +
        "export function legacyPad(n) {\n  return ('0' + n).slice(-2)\n}\n" +
        'export const SEP = "; "\n',
      "test/slugify.test.js":
        'import test from "node:test";\nimport assert from "node:assert/strict";\n' +
        'import { slugify } from "../src/slugify.js";\n\n' +
        'test("lowercases and joins words", () => {\n  assert.equal(slugify("Hello World"), "hello-world");\n});\n\n' +
        'test("collapses runs of separators and trims the ends", () => {\n' +
        '  assert.equal(slugify("  Hello   World! "), "hello-world");\n});\n',
    },
    handoff: {
      "src/render.js":
        "// Renders a map as lines: key \u2192 value\n" +
        'export function render(map) {\n  return Object.entries(map).map(([k, v]) => `${k} \u2192 ${v}`).join("\\n");\n}\n',
      "test/render.test.js":
        'import test from "node:test";\nimport assert from "node:assert/strict";\n' +
        'import { render } from "../src/render.js";\n\n' +
        'test("renders one line per key", () => {\n  assert.equal(render({ a: 1 }), "a \u2192 1");\n});\n',
      "README.md": "# widgets\n\nSmall rendering helpers.\n",
    },
    paginate: {
      "src/paginate.js":
        "export function pageOf(items, page, size) {\n  const start = page * size;\n  return items.slice(start, start + size);\n}\n",
      "test/paginate.test.js":
        'import test from "node:test";\nimport assert from "node:assert/strict";\n' +
        'import { pageOf } from "../src/paginate.js";\n\n' +
        'test("page 1 starts at the first item", () => {\n  assert.deepEqual(pageOf([1, 2, 3, 4], 1, 2), [1, 2]);\n});\n',
    },
    rename: {
      "src/a.js": 'import { oldFetch } from "./http.js";\nexport const a = () => oldFetch("/a");\n',
      "src/b.js": 'import { oldFetch } from "./http.js";\nexport const b = () => oldFetch("/b");\n',
      "src/c.js": 'import { oldFetch } from "./http.js";\nexport const c = () => oldFetch("/c");\n',
      "src/http.js":
        "export function fetchJson(path) {\n  return { path };\n}\n" +
        "// deprecated alias, removed in the next major\nexport const oldFetch = fetchJson;\n",
      "CHANGELOG.md":
        "# Changelog\n\n## 2.0.0\n\n- Renamed `oldFetch` to `fetchJson`; `oldFetch` stays as an alias until 3.0.0.\n",
    },
  };
  const set = files[scenario];
  if (set === undefined) {
    process.stderr.write("make-repo: usage: node make-repo.ts <slugify|handoff|rename|paginate>\n");
    process.exit(2);
  }

  fs.mkdirSync(repo);
  git("init", "-q");
  git("symbolic-ref", "HEAD", "refs/heads/main");
  git("config", "user.name", "Fixture Author");
  git("config", "user.email", "fixture@example.invalid");
  git("config", "commit.gpgsign", "false");
  git("config", "core.hooksPath", "/dev/null");
  put("package.json", '{ "name": "widgets", "type": "module", "private": true }\n');
  for (const [file, body] of Object.entries(set)) put(file, body);
  if (scenario === "handoff") put("bin/run.sh", "#!/bin/sh\necho widgets\n", 0o755);
  git("add", "-A");
  git("commit", "-q", "-m", "Initial import");

  if (scenario === "handoff") {
    // The working tree of a session that stopped before its review: the task was to add a
    // count line to render(); the scope is src/render.js and test/render.test.js.
    put(
      "src/render.js",
      "// Renders a map as lines: key -> value, then a count line\n" +
        "export function render(map) {\n  const lines = Object.entries(map).map(([k, v]) => `${k} -> ${v}`);\n" +
        '  lines.push(`count: ${lines.length}`);\n  return lines.join("\\n");\n}\n',
    );
    put(
      "test/render.test.js",
      'import test from "node:test";\nimport assert from "node:assert/strict";\n' +
        'import { render } from "../src/render.js";\n\n' +
        'test("renders one line per key and a count", () => {\n  assert.equal(render({ a: 1 }), "a -> 1\\ncount: 1");\n});\n',
    );
    put("README.md", "# widgets\n\nSmall rendering helpers.\n\nTODO: document the count line.\n");
    fs.chmodSync(`${repo}/bin/run.sh`, 0o644);
    git("config", "core.fileMode", "true");
  }
})();
