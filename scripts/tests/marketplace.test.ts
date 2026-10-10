// marketplace.test.ts — unit tests of scripts/lib/install/marketplace.ts (spec 0255 R10, R26):
// the upsert over an existing marketplace, same-name replacement, the author fallback chain,
// the missing-manifest line and the shape guard that runs before any write.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import { parseJson } from "../lib/extension/json-ordered.ts";
import type { Manifest } from "../lib/extension/manifest.ts";
import type { Io } from "../lib/extension/types.ts";
import {
  authorName,
  loadManifest,
  marketplaceName,
  upsertMarketplace,
} from "../lib/install/marketplace.ts";
import { REPO } from "./lib/build-fixture-tree.ts";

const LIB_DIR = path.join(REPO, "scripts", "lib");
const dirs: string[] = [];
const tmp = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "marketplace-test-"));
  dirs.push(dir);
  return dir;
};
afterEach(() => dirs.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

function recorder(): { io: Io; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  const io: Io = { out: (l) => void out.push(l), err: (l) => void err.push(l), errRaw: () => {} };
  return { io, out, err };
}

const manifestOf = (json: unknown): Manifest => parseJson(JSON.stringify(json), "m") as Manifest;
const file = (home: string): string => path.join(home, ".claude-plugin", "marketplace.json");
interface Written {
  name: string;
  plugins: { name: string; description: string }[];
}
const read = (home: string): Written => JSON.parse(fs.readFileSync(file(home), "utf8")) as Written;

describe("upsertMarketplace", () => {
  it("creates the manifest from scratch in the jq pretty form", () => {
    const home = tmp();
    const { io, out } = recorder();
    upsertMarketplace(home, "repo-local", "alpha", manifestOf({ description: "d" }), io);
    assert.equal(
      fs.readFileSync(file(home), "utf8"),
      `{\n  "name": "repo-local",\n  "owner": {\n    "name": "crewrig contributors"\n  },\n  "plugins": [\n    {\n      "name": "alpha",\n      "description": "d",\n      "author": {\n        "name": "Unknown"\n      },\n      "source": "./alpha"\n    }\n  ]\n}\n`,
    );
    assert.deepEqual(out, ["  Generated marketplace manifest: repo-local"]);
  });

  it("keeps the prior plugins in order and appends the new entry last", () => {
    const home = tmp();
    fs.mkdirSync(path.dirname(file(home)), { recursive: true });
    fs.writeFileSync(
      file(home),
      JSON.stringify({ name: "seeded", plugins: [{ name: "b", x: 1 }, { name: "a" }] }),
    );
    upsertMarketplace(home, "repo-local", "c", manifestOf({}), recorder().io);
    const doc = read(home);
    assert.equal(doc.name, "repo-local");
    assert.deepEqual(
      doc.plugins.map((p) => p.name),
      ["b", "a", "c"],
    );
  });

  it("replaces an entry of the same name and moves it last", () => {
    const home = tmp();
    const io = recorder().io;
    upsertMarketplace(home, "m", "a", manifestOf({ description: "one" }), io);
    upsertMarketplace(home, "m", "b", manifestOf({}), io);
    upsertMarketplace(home, "m", "a", manifestOf({ description: "two" }), io);
    const doc = read(home);
    assert.deepEqual(
      doc.plugins.map((p) => [p.name, p.description]),
      [
        ["b", ""],
        ["a", "two"],
      ],
    );
  });

  it("refuses a prior manifest whose plugins is not a list, writing nothing", () => {
    const home = tmp();
    fs.mkdirSync(path.dirname(file(home)), { recursive: true });
    fs.writeFileSync(file(home), '{"name":"x"}');
    assert.throws(
      () => upsertMarketplace(home, "m", "a", manifestOf({}), recorder().io),
      /plugins/,
    );
    assert.equal(fs.readFileSync(file(home), "utf8"), '{"name":"x"}');
  });
});

describe("authorName and marketplaceName", () => {
  it("falls from .claude.author.name to .author.name to Unknown", () => {
    assert.equal(
      authorName(manifestOf({ claude: { author: { name: "C" } }, author: { name: "A" } })),
      "C",
    );
    assert.equal(authorName(manifestOf({ claude: {}, author: { name: "A" } })), "A");
    assert.equal(authorName(manifestOf({})), "Unknown");
  });

  it("names the marketplace after the repository directory", () => {
    assert.equal(marketplaceName("/x/y/crewrig"), "crewrig-local");
  });
});

describe("loadManifest", () => {
  it("prints the missing-manifest line on stdout and returns null", () => {
    const dir = tmp();
    const { io, out, err } = recorder();
    assert.equal(loadManifest(dir, LIB_DIR, io), null);
    assert.deepEqual(out, [
      `Error: No extension.json found in ${dir} — run scripts/migrate-extension.sh if this is an old-shape extension (see docs/adoption-guide.md).`,
    ]);
    assert.deepEqual(err, []);
  });

  it("refuses a legacy shape on stderr, so no marketplace is written", () => {
    const dir = tmp();
    fs.writeFileSync(
      path.join(dir, "extension.json"),
      JSON.stringify({ name: "a", components: {} }),
    );
    const { io, err } = recorder();
    assert.equal(loadManifest(dir, LIB_DIR, io), null);
    assert.match(err[0] ?? "", /^VALIDATION-ERROR: .*retired 'components' object/);
  });

  it("returns the manifest of a current shape", () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, "extension.json"), JSON.stringify({ name: "a" }));
    assert.equal(loadManifest(dir, LIB_DIR, recorder().io)?.get("name"), "a");
  });
});
