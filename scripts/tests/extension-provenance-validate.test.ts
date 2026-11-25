// extension-provenance-validate.test.ts — the `provenance` declaration of `extension.json` and
// its tier rule (spec 0316 R7), through `renderExtension` and one standalone builder.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { buildClaudePlugin } from "../lib/extension/plugin-claude.ts";
import { renderExtension } from "../lib/extension/render-extension.ts";
import { TARGETS } from "../lib/extension/types.ts";
import { writeTree } from "./lib/extension-trees.ts";
import { makeCtx, tmpRoot } from "./lib/plugin-ctx.ts";

const CANON = "https://example.test/upstream";

function files(provenance: unknown, pkg: object | null = { name: "p-ext", version: "1.0.0" }) {
  const manifest: Record<string, unknown> = {
    name: "ext",
    version: "1.0.0",
    description: "d",
    skills: { location: "skills/" },
  };
  if (provenance !== undefined) manifest.provenance = provenance;
  const out: Record<string, string> = {
    "extension.json": JSON.stringify(manifest),
    "skills/s/SKILL.md": "---\nname: s\ndescription: s\n---\n\nBody.\n",
  };
  if (pkg !== null) out["package.json"] = JSON.stringify(pkg);
  return out;
}

async function run(tier: string, tree: Record<string, string>) {
  const repo = tmpRoot();
  const extDir = path.join(repo, "extensions", tier, "ext");
  writeTree(extDir, tree);
  const { ctx, out, err } = makeCtx(repo);
  const status = await renderExtension(ctx, extDir, TARGETS);
  return { repo, extDir, status, text: [...out, ...err].join("\n"), ctx, err };
}

const markers = (repo: string): string[] => {
  const hits: string[] = [];
  const walk = (d: string): void => {
    if (!fs.existsSync(d)) return;
    for (const e of fs.readdirSync(d)) {
      const f = path.join(d, e);
      if (fs.statSync(f).isDirectory()) walk(f);
      else if (
        /crewrig-provenance/.test(e) ||
        fs.readFileSync(f, "utf8").includes("crewrig-provenance")
      )
        hits.push(f);
    }
  };
  for (const d of ["build", "dist-copilot-plugin", "dist-antigravity-plugin"])
    walk(path.join(repo, d));
  return hits;
};

describe("provenance shape is rejected on every tier", () => {
  const cases: Array<[string, unknown, RegExp]> = [
    ["a string", "x", /extension\.json: `provenance` must be an object/],
    ["an array", ["x"], /extension\.json: `provenance` must be an object/],
    ["null", null, /extension\.json: `provenance` must be an object/],
    [
      "a numeric canonical",
      { canonical: 3 },
      /extension\.json: `provenance\.canonical` must be a non-empty string/,
    ],
    [
      "an empty feedback",
      { canonical: CANON, feedback: "" },
      /extension\.json: `provenance\.feedback` must be a non-empty string/,
    ],
  ];
  for (const tier of ["core", "org"]) {
    for (const [label, value, re] of cases) {
      it(`${tier}: ${label}`, async () => {
        const r = await run(tier, files(value));
        assert.equal(r.status, 1);
        assert.match(r.text, re);
        assert.deepEqual(markers(r.repo), []);
      });
    }
  }
});

describe("upstream tiers", () => {
  for (const tier of ["core", "library"]) {
    it(`${tier}: no canonical fails and writes no marker`, async () => {
      const r = await run(tier, files(undefined));
      assert.equal(r.status, 1);
      assert.match(r.text, /extension\.json: `provenance\.canonical` is required/);
      assert.deepEqual(markers(r.repo), []);
    });
    it(`${tier}: feedback differing from canonical fails`, async () => {
      const r = await run(tier, files({ canonical: CANON, feedback: "https://other" }));
      assert.equal(r.status, 1);
      assert.match(r.text, /extension\.json: `provenance\.feedback` must equal/);
    });
  }
  it("core: an extension.json without a name fails", async () => {
    const tree = files({ canonical: CANON });
    const manifest = JSON.parse(tree["extension.json"]!) as Record<string, unknown>;
    delete manifest.name;
    tree["extension.json"] = JSON.stringify(manifest);
    const r = await run("core", tree);
    assert.equal(r.status, 1);
    assert.match(r.text, /extension\.json: `name` must be a non-empty string/);
  });
  it("core: a missing package.json fails", async () => {
    const r = await run("core", files({ canonical: CANON }, null));
    assert.equal(r.status, 1);
    assert.match(r.text, /package\.json: `name` must be a non-empty string/);
  });
  it("core: a complete declaration renders with feedback defaulting to canonical", async () => {
    const r = await run("core", files({ canonical: CANON }));
    assert.equal(r.status, 0, r.text);
    const skill = fs.readFileSync(
      path.join(r.repo, "build", "extensions", "ext", "skills", "s", "SKILL.md"),
      "utf8",
    );
    assert.ok(skill.includes(`canonical="${CANON}" feedback="${CANON}"`));
  });
});

describe("org tier", () => {
  it("warns without canonical and writes neither canonical nor feedback (all four targets)", async () => {
    const r = await run("org", files({ feedback: "https://x" }));
    assert.equal(r.status, 0, r.text);
    for (const target of TARGETS) {
      assert.match(r.text, new RegExp(`the ${target} markers carry no canonical or feedback`));
    }
    const hits = markers(r.repo);
    assert.ok(hits.length >= 4);
    for (const hit of hits) {
      const text = fs.readFileSync(hit, "utf8");
      assert.ok(!/canonical|feedback|https:\/\/x/.test(text), hit);
    }
  });

  it("drift between package.json and extension.json versions warns on each target", async () => {
    const r = await run("org", files({ canonical: CANON }, { name: "p-ext", version: "9.9.9" }));
    assert.equal(r.status, 0, r.text);
    for (const target of TARGETS) {
      assert.match(r.text, new RegExp(`the ${target} provenance carries the package.json version`));
    }
  });

  it("without a package.json: renders, no marker and no sidecar", async () => {
    const r = await run("org", files({ canonical: CANON }, null));
    assert.equal(r.status, 0, r.text);
    assert.deepEqual(markers(r.repo), []);
    assert.ok(
      !fs.existsSync(path.join(r.repo, "build", "extensions", "ext", "crewrig-provenance.json")),
    );
  });
});

describe("standalone builder", () => {
  it("build-claude-plugin refuses a core extension without canonical, before any output", () => {
    const repo = tmpRoot();
    const extDir = path.join(repo, "extensions", "core", "ext");
    writeTree(extDir, files(undefined));
    const { ctx, err } = makeCtx(repo);
    const out = path.join(repo, "out");
    assert.equal(buildClaudePlugin(ctx, extDir, out), 1);
    assert.match(err.join("\n"), /`provenance\.canonical` is required/);
    assert.ok(!fs.existsSync(out));
  });

  it("build-claude-plugin stamps like the all-target render", () => {
    const repo = tmpRoot();
    const extDir = path.join(repo, "extensions", "core", "ext");
    writeTree(extDir, files({ canonical: CANON }));
    const { ctx } = makeCtx(repo);
    const out = path.join(repo, "out");
    assert.equal(buildClaudePlugin(ctx, extDir, out), 0);
    assert.ok(
      fs.readFileSync(path.join(out, "skills/s/SKILL.md"), "utf8").includes("crewrig-provenance:"),
    );
    assert.ok(fs.existsSync(path.join(out, "crewrig-provenance.json")));
  });
});
