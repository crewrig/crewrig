// manage-place.test.ts — placeComponent and the one fallback notice (spec 0255 R7, R17, R18).

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import { flushFallbackNotice, newPlaceCtx, placeComponent } from "../lib/manage/place.ts";
import type { PlaceCtx, PlaceMode } from "../lib/manage/place.ts";

const temps: string[] = [];
after(() => {
  for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
});

interface Sandbox {
  root: string;
  src: string;
  destDir: string;
  out: string[];
  err: string[];
}

function sandbox(): Sandbox {
  const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "crewrig-place-")));
  temps.push(root);
  const src = path.join(root, "src", "skill");
  fs.mkdirSync(path.join(src, "sub"), { recursive: true });
  fs.writeFileSync(path.join(src, "SKILL.md"), "new\n");
  const destDir = path.join(root, "home");
  fs.mkdirSync(destDir);
  return { root, src, destDir, out: [], err: [] };
}

function ctxOf(sb: Sandbox, linkOptions?: PlaceCtx["linkOptions"]): PlaceCtx {
  const io = { out: (l: string) => sb.out.push(l), err: (l: string) => sb.err.push(l) };
  return newPlaceCtx(io, {}, "linux", linkOptions);
}

const refuseEperm: NonNullable<PlaceCtx["linkOptions"]> = {
  platform: "win32",
  symlinkImpl: () => {
    throw Object.assign(new Error("EPERM"), { code: "EPERM" });
  },
};

const states: Record<string, (dest: string, sb: Sandbox) => void> = {
  absent: () => {},
  file: (dest) => fs.writeFileSync(dest, "old"),
  directory: (dest) => {
    fs.mkdirSync(dest);
    fs.writeFileSync(path.join(dest, "old.txt"), "old");
  },
  symlink: (dest, sb) => fs.symlinkSync(sb.src, dest),
  "dangling symlink": (dest, sb) => fs.symlinkSync(path.join(sb.root, "nowhere"), dest),
};

describe("placement over every existing destination state", () => {
  for (const mode of ["install", "link"] as const satisfies readonly PlaceMode[]) {
    for (const [state, seed] of Object.entries(states)) {
      test(`${mode} over ${state}`, () => {
        const sb = sandbox();
        const dest = path.join(sb.destDir, "skill");
        seed(dest, sb);
        const outcome = placeComponent(sb.src, sb.destDir, mode, ctxOf(sb));
        assert.equal(outcome?.method, mode === "link" ? "link" : "copy");
        assert.deepEqual(sb.out, [`  ${mode === "link" ? "Linked" : "Copied"}: skill`]);
        assert.equal(fs.lstatSync(dest).isSymbolicLink(), mode === "link");
        assert.equal(fs.readFileSync(path.join(dest, "SKILL.md"), "utf8"), "new\n");
        assert.equal(fs.existsSync(path.join(dest, "old.txt")), false);
        // A replaced link never touches its target.
        assert.equal(fs.readFileSync(path.join(sb.src, "SKILL.md"), "utf8"), "new\n");
      });
    }
  }
});

describe("placeComponent details", () => {
  test(".gitkeep is skipped: no output, no outcome, no name", () => {
    const sb = sandbox();
    const keep = path.join(sb.root, "src", ".gitkeep");
    fs.writeFileSync(keep, "");
    const ctx = ctxOf(sb);
    assert.equal(placeComponent(keep, sb.destDir, "install", ctx), undefined);
    assert.deepEqual(
      [sb.out, ctx.placed, ctx.outcomes, fs.readdirSync(sb.destDir)],
      [[], [], [], []],
    );
  });

  test("a trailing slash keeps the component's own name", () => {
    for (const mode of ["install", "link"] as const) {
      const sb = sandbox();
      placeComponent(`${sb.src}/`, sb.destDir, mode, ctxOf(sb));
      assert.deepEqual(fs.readdirSync(sb.destDir), ["skill"]);
      assert.equal(fs.readFileSync(path.join(sb.destDir, "skill", "SKILL.md"), "utf8"), "new\n");
    }
  });

  test("a refused link prints Copied: and collects a fallback", () => {
    const sb = sandbox();
    const ctx = ctxOf(sb, refuseEperm);
    const outcome = placeComponent(sb.src, sb.destDir, "link", ctx);
    assert.equal(outcome?.method, "fallback-copy");
    assert.deepEqual(sb.out, ["  Copied: skill"]);
    assert.equal(fs.lstatSync(path.join(sb.destDir, "skill")).isSymbolicLink(), false);
    assert.equal(ctx.outcomes.length, 1);
  });

  test("a link error that is not a refusal propagates", () => {
    const sb = sandbox();
    const boom = {
      platform: "win32",
      symlinkImpl: () => {
        throw Object.assign(new Error("EIO"), { code: "EIO" });
      },
    };
    assert.throws(() => placeComponent(sb.src, sb.destDir, "link", ctxOf(sb, boom)), /EIO/);
    assert.deepEqual(sb.out, []);
  });

  test("one notice per process names every fallback destination; none without a fallback", () => {
    const sb = sandbox();
    const second = path.join(sb.root, "src", "other");
    fs.mkdirSync(second);
    const ctx = ctxOf(sb, refuseEperm);
    placeComponent(sb.src, sb.destDir, "link", ctx);
    placeComponent(second, sb.destDir, "link", ctx);
    flushFallbackNotice(ctx);
    assert.equal(sb.err.length, 1);
    assert.match(sb.err[0] ?? "", /\(EPERM\)/);
    const lines = (sb.err[0] ?? "").split("\n");
    for (const name of ["skill", "other"]) {
      assert.ok(lines.includes(`  ${path.join(sb.destDir, name)}`), name);
    }
    const clean = sandbox();
    const cleanCtx = ctxOf(clean);
    placeComponent(clean.src, clean.destDir, "link", cleanCtx);
    flushFallbackNotice(cleanCtx);
    assert.deepEqual(clean.err, []);
  });

  test("placed names are collected in order", () => {
    const sb = sandbox();
    const ctx = ctxOf(sb);
    const names = ["zeta", "alpha", "mid"];
    for (const n of names) {
      const dir = path.join(sb.root, "src", n);
      fs.mkdirSync(dir);
      placeComponent(dir, sb.destDir, "install", ctx);
    }
    assert.deepEqual(ctx.placed, names);
    assert.deepEqual(
      sb.out,
      names.map((n) => `  Copied: ${n}`),
    );
  });
});
