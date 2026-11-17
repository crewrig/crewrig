// Black-box test of user-validate/scripts/render-gate-html.ts: the three themes, escaping, --dry-run.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { after, describe, test } from "node:test";

import { envelope, run, tempDir } from "./lib/skill-scripts-governance-cli.ts";

const tmp = tempDir("render-gate-");
after(() => fs.rmSync(tmp, { recursive: true, force: true }));
const body = path.join(tmp, "body.html");
fs.writeFileSync(body, "<p>Retry budget of 3 attempts</p>\n");
const render = (theme: string, extra: string[] = []) => {
  const out = path.join(tmp, `${theme}.html`);
  const r = run("user-validate", "render-gate-html.ts", [
    "--title",
    "Approve <this> plan?",
    "--body-file",
    body,
    "--theme",
    theme,
    "--out",
    out,
    "--json",
    ...extra,
  ]);
  return { r, out };
};

describe("render-gate-html", () => {
  test("dark: explicit dark metadata, inline colours on body and main, body inserted", () => {
    const { r, out } = render("dark");
    assert.equal(r.status, 0, r.stderr);
    const html = fs.readFileSync(out, "utf8");
    assert.match(html, /<meta name="color-scheme" content="dark only">/);
    assert.match(html, /<body style="[^"]*background:#0d1117; color:#e6edf3/);
    assert.match(html, /<main style="[^"]*background:#161b22/);
    assert.ok(html.includes("<p>Retry budget of 3 attempts</p>"));
    assert.equal(envelope(r).data?.["written"], true);
  });
  test("light: explicit light metadata", () => {
    const { out } = render("light");
    const html = fs.readFileSync(out, "utf8");
    assert.match(html, /content="light only"/);
    assert.match(html, /<body style="[^"]*background:#ffffff/);
  });
  test("auto and system: adaptive variables in a body-scoped style block, never in head", () => {
    for (const theme of ["auto", "system"]) {
      const { out } = render(theme);
      const html = fs.readFileSync(out, "utf8");
      assert.match(html, /content="light dark"/);
      const head = html.slice(html.indexOf("<head>"), html.indexOf("</head>"));
      assert.ok(!head.includes("<style"));
      const bodyPart = html.slice(html.indexOf("<body"));
      assert.match(bodyPart, /<style>[\s\S]*prefers-color-scheme: dark[\s\S]*<\/style>/);
      assert.match(bodyPart, /<body style=|<main class="card" style=/);
    }
  });
  test("the title is escaped", () => {
    const { out } = render("dark");
    assert.ok(
      fs
        .readFileSync(out, "utf8")
        .includes('<h1 style="color:#e6edf3;">Approve &lt;this&gt; plan?</h1>'),
    );
  });
  test("--dry-run writes nothing", () => {
    const { r, out } = render("dry", []);
    assert.equal(r.status, 2); // unknown theme
    const d = run("user-validate", "render-gate-html.ts", [
      "--title",
      "t",
      "--body-file",
      body,
      "--out",
      path.join(tmp, "never.html"),
      "--dry-run",
      "--json",
    ]);
    assert.equal(d.status, 0);
    assert.equal(envelope(d).data?.["written"], false);
    assert.ok(!fs.existsSync(path.join(tmp, "never.html")));
    assert.ok(!fs.existsSync(out));
  });
  test("without --out the page goes to the temporary directory", () => {
    const r = run(
      "user-validate",
      "render-gate-html.ts",
      ["--title", "t", "--body-file", "-", "--json"],
      {
        input: "<p>x</p>",
        env: { TMPDIR: tmp },
      },
    );
    assert.equal(r.status, 0);
    const p = envelope(r).data?.["path"] as string;
    assert.ok(p.startsWith(tmp) && fs.existsSync(p));
  });
  test("exit codes: --help 0, missing option 2, unreadable body 3", () => {
    assert.equal(run("user-validate", "render-gate-html.ts", ["--help"]).status, 0);
    assert.equal(run("user-validate", "render-gate-html.ts", ["--title", "t", "--json"]).status, 2);
    const r = run("user-validate", "render-gate-html.ts", [
      "--title",
      "t",
      "--body-file",
      path.join(tmp, "nope"),
      "--json",
    ]);
    assert.equal(r.status, 3);
  });
});
