// windows-skill-lint.ts — the `lint-skill`, argument-refusal and carriage-return cases of the
// cross-system proof of the eleven skill entries (spec 0258 R27; the `.cmd` launch rule of R6).
// `lint-skill` runs in place (js-yaml resolved from the checkout), in a COPIED directory with no
// node_modules above it (the `js-yaml not found` note and no module-resolution error), and against a
// throwaway git repository with the runner's git, `GIT_CONFIG_NOSYSTEM=1` (never
// `GIT_CONFIG_SYSTEM=<os.devNull>`: that variable is not a null device on every git).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { baseEnv } from "./windows-packaging-driver.ts";
import { entry } from "./windows-skill-cases.ts";
import { attempt, calls, exec } from "./windows-skill-proof.ts";
import type { Ctx } from "./windows-skill-proof.ts";
import { expectStatus, why, WIN } from "./windows-proof-support.ts";

const SKILL = (version: string, license = "license: MIT\n"): string =>
  `---\nname: demo\ndescription: demo skill\n${license}compatibility: any\nmetadata:\n  provenance:\n    version: ${version}\n---\nbody\n`;
const LINT = entry("pr-reviewer", "lint-skill");
const GIT_ENV = { GIT_CONFIG_NOSYSTEM: "1" };

function git(c: Ctx, cwd: string, args: string[]): void {
  const dir = c.box.git;
  assert.ok(dir !== undefined, "git is not on the parent PATH");
  const system = WIN ? path.win32.join(process.env["SystemRoot"] ?? "C:\\Windows", "System32") : "";
  const pathValue = [dir, system].filter((d) => d !== "").join(path.delimiter);
  const env = baseEnv(pathValue, c.box.home, c.box.tmp, GIT_ENV);
  const identity = ["-c", "user.name=t", "-c", "user.email=t@example.invalid"];
  const res = spawnSync(path.join(dir, WIN ? "git.exe" : "git"), [...identity, ...args], {
    cwd,
    env,
    encoding: "utf8",
    windowsHide: true,
  });
  assert.equal(res.status, 0, `git ${args.join(" ")}: ${res.stdout}${res.stderr}${res.error}`);
}

export function lintSkill(c: Ctx): void {
  const { box } = c;
  fs.writeFileSync(path.join(box.work, "SKILL.md"), SKILL("1.0.0"));
  fs.writeFileSync(path.join(box.work, "NOLICENSE.md"), SKILL("1.0.0", ""));
  attempt(c, "ws-lint-skill-in-place", () => {
    const good = exec(c, LINT, ["SKILL.md"]);
    expectStatus(good, 0);
    assert.equal(good.out, "", why(good, "the checkout carries js-yaml: no note"));
    const bad = exec(c, LINT, ["NOLICENSE.md", "nope.md"]);
    expectStatus(bad, 1);
    assert.equal(
      bad.out,
      "NOLICENSE.md: missing required frontmatter key: license\nnope.md: not a regular file\n",
      why(bad, "findings"),
    );
  });
  attempt(c, "ws-lint-skill-copied-directory", () => {
    const copied = path.join(box.root, "copied", "lint-skill.ts");
    fs.mkdirSync(path.dirname(copied), { recursive: true });
    fs.copyFileSync(LINT, copied);
    const good = exec(c, copied, ["SKILL.md"]);
    expectStatus(good, 0);
    assert.match(
      good.out,
      /^lint-skill: js-yaml not found — using line fallback/,
      why(good, "note"),
    );
    assert.ok(!/ERR_MODULE_NOT_FOUND|Cannot find module/.test(good.err), why(good, "stderr"));
    const bad = exec(c, copied, ["NOLICENSE.md"]);
    expectStatus(bad, 1);
    assert.ok(
      bad.out.endsWith("NOLICENSE.md: missing required frontmatter key: license\n"),
      why(bad, "the fallback still checks the keys"),
    );
  });
  attempt(c, "ws-lint-skill-git-base", () => {
    const repo = path.join(box.work, "repo");
    fs.mkdirSync(repo, { recursive: true });
    fs.writeFileSync(path.join(repo, "SKILL.md"), SKILL("1.0.0"));
    git(c, repo, ["init", "-q"]);
    git(c, repo, ["add", "SKILL.md"]);
    git(c, repo, ["-c", "commit.gpgsign=false", "commit", "-q", "-m", "base"]);
    const o = { cwd: repo, git: true, env: { ...GIT_ENV, BASE_REF: "HEAD" } };
    const same = exec(c, LINT, ["SKILL.md"], o);
    expectStatus(same, 1);
    assert.equal(
      same.out,
      "SKILL.md: version not bumped vs HEAD (still 1.0.0)\n",
      why(same, "base"),
    );
    fs.writeFileSync(path.join(repo, "SKILL.md"), SKILL("1.0.1"));
    const bumped = exec(c, LINT, ["SKILL.md"], o);
    expectStatus(bumped, 0);
    assert.equal(bumped.out, "", why(bumped, "a bumped version is clean"));
  });
}

/** The characters the `.cmd` launch rule refuses; `"` and a newline cannot go through a shell leg. */
const SHELL_CHARS = ["&", "%", "^", "|", "<", ">"];
const ALL_CHARS = [...SHELL_CHARS, '"', "\n"];

export function refusals(c: Ctx): void {
  attempt(c, "ws-cmd-launch-refusals", () => {
    if (!WIN) return; // the rule is a Windows one: a POSIX stub is an executable, never a `.cmd`
    for (const ch of c.leg === "direct" ? ALL_CHARS : SHELL_CHARS) {
      const arg = `a${ch}b.md`;
      const md = exec(c, entry("pr-reviewer", "lint-markdown"), [arg]);
      expectStatus(md, 1);
      assert.match(
        md.out,
        /^lint-markdown\.ts: refusing an argument that cmd\.exe would interpret/,
        why(md, JSON.stringify(arg)),
      );
      const job = exec(c, entry("github-actions", "simulate-job"), [
        "wf/.github/workflows/ci.yml",
        "b",
        arg,
      ]);
      expectStatus(job, 1);
      assert.match(
        job.err,
        /refusing an argument that cmd\.exe would interpret/,
        why(job, JSON.stringify(arg)),
      );
      assert.deepEqual(
        calls(c.box).filter((x) => x.tool !== "docker"),
        [],
        "no wrapped tool ran",
      );
    }
  });
}

/** No carriage return in a file an entry wrote under the landing zone, and no `bash` was spawned. */
export function noCarriageReturn(c: Ctx): void {
  attempt(c, "ws-no-cr", () => {
    assert.ok(c.proof.landed.length >= 1, "no written file was recorded");
    for (const { label, bytes } of c.proof.landed)
      assert.ok(!bytes.includes(13), `${label} holds a carriage return`);
    if (fs.existsSync(c.box.trip.bashLog))
      assert.fail(`bash was spawned: ${fs.readFileSync(c.box.trip.bashLog, "utf8")}`);
  });
}
