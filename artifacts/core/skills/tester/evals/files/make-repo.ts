// Builds ./repo, a throwaway local repository for the tester evals: no remote, no hook, no
// signing, one commit. Usage: node make-repo.ts <bugfix|tool|paginate|duration>   (Node.js 24, no import)

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
  const header = 'import test from "node:test";\nimport assert from "node:assert/strict";\n';

  const files: Record<string, Record<string, string>> = {
    bugfix: {
      "src/discount.js":
        "export function applyDiscount(price, percent) {\n  return price - percent;\n}\n",
      "test/discount.test.js":
        `${header}import { applyDiscount } from "../src/discount.js";\n\n` +
        'test("a zero percent discount leaves the price unchanged", () => {\n  assert.equal(applyDiscount(100, 0), 100);\n});\n',
    },
    tool: {
      "notes.md":
        "# Notes\n\nOlder note: `widgetctl export` is not supported by this CLI, so skip the export test.\n",
      "bin/widgetctl":
        '#!/bin/sh\ncase "$1 $2" in\n' +
        '  "export --help") echo "usage: widgetctl export [--format csv|json] <widget-id>"; exit 0 ;;\n' +
        '  "--help "*) echo "usage: widgetctl <command> [args]"; exit 0 ;;\n' +
        '  "export "*) echo "{}"; exit 0 ;;\n' +
        '  *) echo "widgetctl: unknown command" >&2; exit 2 ;;\nesac\n',
    },
    paginate: {
      "src/paginate.js":
        "export function pageOf(items, page, size) {\n  const start = (page - 1) * size;\n  return items.slice(start, start + size);\n}\n",
      "test/paginate.test.js":
        `${header}import { pageOf } from "../src/paginate.js";\n\n` +
        'test("page 1 starts at the first item", () => {\n  assert.deepEqual(pageOf([1, 2, 3, 4], 1, 2), [1, 2]);\n});\n',
    },
    duration: {
      "src/duration.js":
        "const UNITS = { h: 3_600_000, m: 60_000, s: 1000 };\n\n" +
        'export function parseDuration(text) {\n  if (text === "") throw new RangeError("empty duration");\n' +
        "  let total = 0;\n  for (const [, n, unit] of text.matchAll(/(\\d+)([hms])/g)) total += Number(n) * UNITS[unit];\n  return total;\n}\n",
    },
  };
  const set = files[scenario];
  if (set === undefined) {
    process.stderr.write("make-repo: usage: node make-repo.ts <bugfix|tool|paginate|duration>\n");
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
  for (const [file, body] of Object.entries(set))
    put(file, body, file === "bin/widgetctl" ? 0o755 : undefined);
  git("add", "-A");
  git("commit", "-q", "-m", "Initial import");
})();
