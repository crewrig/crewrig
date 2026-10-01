// hook-wiring.test.ts — black-box tests for scripts/hook-wiring.ts, the tool the
// Bash setups reach through `node` (spec 0243 R19, R23, R26).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import { GUARDED_PREFIX, MEASURED_SURFACES, type MeasuredSurface } from "../lib/hook-command.ts";
import { USAGE_CAPTURE, type WiredCli } from "../lib/hook-descriptor.ts";
import { installStatusline, rewriteStatusline } from "../lib/hook-statusline.ts";
import { parseHandler } from "../lib/hook-recognition.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const TOOL = path.join(REPO, "scripts", "hook-wiring.ts");
const posix = process.platform !== "win32";
// A read-only directory does not stop root: the failing-backup tests need a non-root user.
const canDenyWrite = posix && !(typeof process.getuid === "function" && process.getuid() === 0);
const CLIS: readonly WiredCli[] = ["claude", "gemini", "copilot"];

const temps: string[] = [];
after(() => {
  for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true });
});

/** A checkout holding the real fragments and stub entries: what `--repo` needs. */
function fixtureRepo(name = "co"): string {
  const root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "crewrig-hook-wiring-")),
  );
  temps.push(root);
  const repo = path.join(root, name);
  fs.mkdirSync(path.join(repo, "hooks"), { recursive: true });
  for (const cli of CLIS) {
    fs.copyFileSync(
      path.join(REPO, "hooks", `${cli}-usage-capture-hooks.json`),
      path.join(repo, "hooks", `${cli}-usage-capture-hooks.json`),
    );
  }
  for (const stub of ["usage-capture", "antigravity-statusline-shim"]) {
    fs.writeFileSync(path.join(repo, "hooks", `${stub}.ts`), "// entry\n");
    fs.writeFileSync(path.join(repo, "hooks", `${stub}.sh`), "#!/bin/bash\n");
  }
  return repo;
}

function wiring(...args: string[]): { status: number | null; stdout: string; stderr: string } {
  const res = spawnSync(
    process.execPath,
    [
      "--disable-warning=ExperimentalWarning",
      "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
      TOOL,
      ...args,
    ],
    { encoding: "utf8" },
  );
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

const mode = (file: string): number => fs.statSync(file).mode & 0o777;
const backups = (file: string): string[] =>
  fs.readdirSync(path.dirname(file)).filter((n) => n.startsWith(`${path.basename(file)}.bak.`));

describe("render (R16, R26)", () => {
  for (const cli of CLIS) {
    test(`${cli}: the fragment carries only the direct command, every token replaced, and reads back as capture`, () => {
      const repo = fixtureRepo();
      const res = wiring("render", cli, "--repo", repo);
      assert.equal(res.status, 0, res.stderr);
      assert.ok(!/PROJECT_DIR|\$PWD/.test(res.stdout), res.stdout);
      const fragment = JSON.parse(res.stdout) as { hooks: Record<string, unknown[]> };
      const commands: string[] = [];
      const walk = (node: unknown): void => {
        if (Array.isArray(node)) node.forEach(walk);
        else if (typeof node === "object" && node !== null) {
          const record = node as Record<string, unknown>;
          if (record["type"] === "command") {
            commands.push(record["command"] as string);
            assert.notEqual(parseHandler(record, USAGE_CAPTURE), null, String(record["command"]));
          }
          Object.values(record).forEach(walk);
        }
      };
      walk(fragment);
      const script = path.join(repo, "hooks", "usage-capture.ts");
      assert.ok(commands.length > 0);
      for (const command of commands) {
        assert.ok(command.startsWith(`node "${script}" ${USAGE_CAPTURE.cliIds[cli]} `), command);
      }
    });
  }

  test(
    "an unusable checkout path is refused, nothing is printed on stdout",
    { skip: !posix },
    () => {
      const repo = fixtureRepo("a\\b");
      const res = wiring("render", "claude", "--repo", repo);
      assert.equal(res.status, 1);
      assert.equal(res.stdout, "");
      assert.ok(res.stderr.includes("checkout path"), res.stderr);
    },
  );

  test("a missing entry script is an error", () => {
    const repo = fixtureRepo();
    fs.rmSync(path.join(repo, "hooks", "usage-capture.ts"));
    assert.equal(wiring("render", "gemini", "--repo", repo).status, 1);
  });
});

describe("rewrite (R19, R22, R23)", () => {
  const legacyConfig = (repo: string): unknown => ({
    model: "opus",
    hooks: {
      Stop: [
        {
          matcher: "",
          hooks: [
            { type: "command", command: `bash "${repo}/hooks/usage-capture.sh" claude-code Stop` },
          ],
        },
      ],
    },
  });

  test(
    "refuses the write, exit 1 and the file untouched, when the backup fails (security review finding 2)",
    { skip: !canDenyWrite },
    () => {
      const repo = fixtureRepo();
      const dir = path.join(path.dirname(repo), "locked");
      fs.mkdirSync(dir);
      const config = path.join(dir, "settings.json");
      const before = JSON.stringify(legacyConfig(repo));
      fs.writeFileSync(config, before);
      fs.chmodSync(dir, 0o555);
      try {
        const res = wiring("rewrite", "claude", "--config", config, "--repo", repo);
        assert.equal(res.status, 1, res.stdout + res.stderr);
        assert.ok(res.stderr.includes("could not back up"), res.stderr);
        assert.equal(fs.readFileSync(config, "utf8"), before);
        assert.deepEqual(backups(config), []);
      } finally {
        fs.chmodSync(dir, 0o755);
      }
    },
  );

  test(
    "rewrites, backs up first, ends 0600, reports by name and count; a second run writes nothing",
    { skip: !posix },
    () => {
      const repo = fixtureRepo();
      const config = path.join(path.dirname(repo), "settings.json");
      fs.writeFileSync(config, JSON.stringify(legacyConfig(repo)), { mode: 0o644 });
      fs.chmodSync(config, 0o644);
      const first = wiring("rewrite", "claude", "--config", config, "--repo", repo);
      assert.equal(first.status, 0, first.stderr);
      assert.match(first.stdout, /rewrote .*usage-capture\.sh on Stop/);
      assert.match(first.stdout, /rewrote 1, left 0, dropped 0/);
      const written = JSON.parse(fs.readFileSync(config, "utf8")) as {
        hooks: { Stop: { hooks: { command: string }[] }[] };
      };
      assert.equal(
        written.hooks.Stop[0]?.hooks[0]?.command,
        `node "${path.join(repo, "hooks", "usage-capture.ts")}" claude-code Stop`,
      );
      assert.equal(mode(config), 0o600);
      assert.equal(backups(config).length, 1);
      assert.equal(mode(path.join(path.dirname(config), backups(config)[0] ?? "")), 0o600);

      const after1 = fs.readFileSync(config, "utf8");
      const second = wiring("rewrite", "claude", "--config", config, "--repo", repo);
      assert.equal(second.status, 0);
      assert.match(second.stdout, /nothing written/);
      assert.equal(fs.readFileSync(config, "utf8"), after1);
      assert.equal(backups(config).length, 1);
    },
  );

  test("a configuration that is not a JSON object is refused and left byte-identical", () => {
    const repo = fixtureRepo();
    const config = path.join(path.dirname(repo), "settings.json");
    fs.writeFileSync(config, "[1,2]\n");
    const res = wiring("rewrite", "claude", "--config", config, "--repo", repo);
    assert.equal(res.status, 1);
    assert.equal(fs.readFileSync(config, "utf8"), "[1,2]\n");
    assert.deepEqual(backups(config), []);
  });

  test("an absent configuration is a no-op", () => {
    const repo = fixtureRepo();
    const config = path.join(path.dirname(repo), "missing.json");
    const res = wiring("rewrite", "gemini", "--config", config, "--repo", repo);
    assert.equal(res.status, 0);
    assert.equal(fs.existsSync(config), false);
  });

  test("the configuration content never reaches argv: only the path does", () => {
    // The tool takes `--config <path>`; there is no option carrying content.
    const res = wiring("rewrite", "claude", "--repo", fixtureRepo());
    assert.equal(res.status, 2);
    assert.match(res.stderr, /usage/);
  });

  test("an unknown CLI is a usage error", () => {
    assert.equal(wiring("render", "antigravity").status, 2);
  });
});

describe("statusline (R19, R20, D5)", () => {
  function paths(): { repo: string; settings: string; marker: string } {
    const repo = fixtureRepo();
    const dir = path.dirname(repo);
    return {
      repo,
      settings: path.join(dir, "agy", "settings.json"),
      marker: path.join(dir, "usage", "state", "antigravity-statusline.json"),
    };
  }
  const run = (
    action: string,
    p: { repo: string; settings: string; marker: string },
    ...extra: string[]
  ) =>
    wiring(
      "statusline",
      action,
      "--settings",
      p.settings,
      "--marker",
      p.marker,
      "--repo",
      p.repo,
      ...extra,
    );
  const json = (file: string): Record<string, unknown> =>
    JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;

  test(
    "install writes the direct command, the marker first, both at 0600",
    { skip: !posix },
    () => {
      const p = paths();
      const res = run("install", p);
      assert.equal(res.status, 0, res.stdout + res.stderr);
      const command = `node "${path.join(p.repo, "hooks", "antigravity-statusline-shim.ts")}"`;
      assert.equal((json(p.settings)["statusLine"] as { command: string }).command, command);
      assert.equal(json(p.marker)["installedStatusLineCommand"], command);
      assert.equal(json(p.marker)["priorStatusLineCommand"], "");
      assert.equal(mode(p.settings), 0o600);
      assert.equal(mode(p.marker), 0o600);
    },
  );

  test("install over a foreign statusLine.command changes nothing", () => {
    const p = paths();
    fs.mkdirSync(path.dirname(p.settings), { recursive: true });
    fs.writeFileSync(p.settings, '{"statusLine":{"command":"echo mine"}}\n');
    const res = run("install", p);
    assert.equal(res.status, 1);
    assert.equal(fs.readFileSync(p.settings, "utf8"), '{"statusLine":{"command":"echo mine"}}\n');
    assert.equal(fs.existsSync(p.marker), false);
  });

  // Spec 0243 delta-03, scenario "A measured guarded form wires the Windows statusline".
  test(
    "a Windows statusline install writes the guarded form after a 0600 backup; keep then writes nothing (R16c, R22, R34)",
    { skip: !posix },
    () => {
      const p = paths();
      fs.mkdirSync(path.dirname(p.settings), { recursive: true });
      fs.writeFileSync(p.settings, JSON.stringify({ theme: "dark" }));
      const res = run("install", p, "--platform", "win32");
      assert.equal(res.status, 0, res.stdout + res.stderr);
      const command = `${GUARDED_PREFIX}node ${path.join(p.repo, "hooks", "antigravity-statusline-shim.ts")}`;
      assert.equal((json(p.settings)["statusLine"] as { command: string }).command, command);
      assert.equal(json(p.marker)["installedStatusLineCommand"], command);
      assert.equal(json(p.marker)["priorStatusLineCommand"], "");
      const made = backups(p.settings);
      assert.equal(made.length, 1);
      assert.equal(mode(path.join(path.dirname(p.settings), made[0] ?? "")), 0o600);
      assert.equal(mode(p.settings), 0o600);
      assert.ok(!res.stdout.includes("current-directory lookup"), "no prior command: no R35 note");

      const settingsBefore = fs.readFileSync(p.settings, "utf8");
      const markerBefore = fs.readFileSync(p.marker, "utf8");
      const keep = run("rewrite", p, "--platform", "win32");
      assert.equal(keep.status, 0, keep.stdout + keep.stderr);
      assert.match(keep.stdout, /left statusLine\.command \(already the direct form\)/);
      assert.equal(fs.readFileSync(p.settings, "utf8"), settingsBefore);
      assert.equal(fs.readFileSync(p.marker, "utf8"), markerBefore);
      assert.equal(backups(p.settings).length, 1, "keep creates no backup");
    },
  );

  // Spec 0243 delta-03, scenario "A path with a space is refused by the path for the statusline".
  test(
    "a Windows install from a path with a space is refused by R17, writing nothing, with no backup",
    { skip: !posix },
    () => {
      const repo = fixtureRepo("Ana Diaz");
      const dir = path.dirname(repo);
      const p = {
        repo,
        settings: path.join(dir, "agy", "settings.json"),
        marker: path.join(dir, "usage", "state", "antigravity-statusline.json"),
      };
      fs.mkdirSync(path.dirname(p.settings), { recursive: true });
      const before = JSON.stringify({ statusLine: { padding: 1 } });
      fs.writeFileSync(p.settings, before);
      const res = run("install", p, "--platform", "win32");
      assert.equal(res.status, 1, res.stdout + res.stderr);
      assert.match(res.stdout, /left statusLine\.command/);
      assert.ok(res.stdout.includes("whitespace") && res.stdout.includes("Ana Diaz"), res.stdout);
      assert.ok(!res.stdout.includes("#1392"), res.stdout);
      assert.equal(fs.readFileSync(p.settings, "utf8"), before);
      assert.equal(fs.existsSync(p.marker), false);
      assert.deepEqual(backups(p.settings), []);
    },
  );

  test(
    "rewrite of a bare .sh command completes the write order and leaves the prior command",
    { skip: !posix },
    () => {
      const p = paths();
      const legacy = path.join(p.repo, "hooks", "antigravity-statusline-shim.sh");
      fs.mkdirSync(path.dirname(p.settings), { recursive: true });
      fs.mkdirSync(path.dirname(p.marker), { recursive: true });
      fs.writeFileSync(p.settings, JSON.stringify({ statusLine: { command: legacy, padding: 2 } }));
      fs.writeFileSync(
        p.marker,
        JSON.stringify({
          priorStatusLineCommand: "echo prior",
          installedStatusLineCommand: legacy,
          installedBy: "t",
        }),
      );
      const res = run("rewrite", p);
      assert.equal(res.status, 0, res.stdout + res.stderr);
      const command = `node "${path.join(p.repo, "hooks", "antigravity-statusline-shim.ts")}"`;
      assert.deepEqual(json(p.settings)["statusLine"], { command, padding: 2 });
      assert.deepEqual(json(p.marker), {
        priorStatusLineCommand: "echo prior",
        installedStatusLineCommand: command,
        installedBy: "t",
      });
      assert.equal(backups(p.settings).length, 1);
    },
  );

  test(
    "install refuses, exit 1 with settings and marker untouched, when the backup fails (security review finding 2)",
    { skip: !canDenyWrite },
    () => {
      const p = paths();
      fs.mkdirSync(path.dirname(p.settings), { recursive: true });
      const before = JSON.stringify({ theme: "dark" });
      fs.writeFileSync(p.settings, before);
      fs.chmodSync(path.dirname(p.settings), 0o555);
      try {
        const res = run("install", p);
        assert.equal(res.status, 1, res.stdout + res.stderr);
        assert.ok((res.stdout + res.stderr).includes("could not back up"), res.stdout + res.stderr);
        assert.equal(fs.readFileSync(p.settings, "utf8"), before);
        assert.equal(fs.existsSync(p.marker), false);
      } finally {
        fs.chmodSync(path.dirname(p.settings), 0o755);
      }
    },
  );

  test(
    "rewrite refuses, exit 1 with settings and marker untouched, when the backup fails (security review finding 2)",
    { skip: !canDenyWrite },
    () => {
      const p = paths();
      const legacy = path.join(p.repo, "hooks", "antigravity-statusline-shim.sh");
      fs.mkdirSync(path.dirname(p.settings), { recursive: true });
      fs.mkdirSync(path.dirname(p.marker), { recursive: true });
      const settings = JSON.stringify({ statusLine: { command: legacy } });
      const marker = JSON.stringify({
        priorStatusLineCommand: "",
        installedStatusLineCommand: legacy,
        installedBy: "t",
      });
      fs.writeFileSync(p.settings, settings);
      fs.writeFileSync(p.marker, marker);
      fs.chmodSync(path.dirname(p.settings), 0o555);
      try {
        const res = run("rewrite", p);
        assert.equal(res.status, 1, res.stdout + res.stderr);
        assert.equal(fs.readFileSync(p.settings, "utf8"), settings);
        assert.equal(fs.readFileSync(p.marker, "utf8"), marker);
      } finally {
        fs.chmodSync(path.dirname(p.settings), 0o755);
      }
    },
  );

  test("an older checkout without the .ts is left", () => {
    const p = paths();
    fs.rmSync(path.join(p.repo, "hooks", "antigravity-statusline-shim.ts"));
    const legacy = path.join(p.repo, "hooks", "antigravity-statusline-shim.sh");
    fs.mkdirSync(path.dirname(p.settings), { recursive: true });
    fs.mkdirSync(path.dirname(p.marker), { recursive: true });
    const settings = JSON.stringify({ statusLine: { command: legacy } });
    fs.writeFileSync(p.settings, settings);
    fs.writeFileSync(p.marker, JSON.stringify({ installedStatusLineCommand: legacy }));
    const res = run("rewrite", p);
    assert.equal(res.status, 0);
    assert.equal(fs.readFileSync(p.settings, "utf8"), settings);
  });
});

// Spec 0243 delta-03 R18, R34, R35 through the library, with the `measuredSurfaces`
// seam standing in for an entry in another R32 state.
describe("Windows statusline keep, upgrade and re-point (R34, R35)", () => {
  const SHIM = (repo: string): string => path.join(repo, "hooks", "antigravity-statusline-shim.ts");
  /** The shipped constant with the statusline entry taken back to R32(c): no guarded-form result. */
  const STATE_C: readonly MeasuredSurface[] = MEASURED_SURFACES.map((m) => {
    if (m.cli !== "antigravity" || m.surface !== "statusline") return m;
    const copy: Record<string, unknown> = { ...m };
    delete copy["guardedForm"];
    delete copy["guardedCaveats"];
    return copy as unknown as MeasuredSurface;
  });

  function setup(command: string, prior = "") {
    const repo = fixtureRepo();
    const dir = path.dirname(repo);
    const settings = path.join(dir, "agy", "settings.json");
    const marker = path.join(dir, "usage", "state", "antigravity-statusline.json");
    fs.mkdirSync(path.dirname(settings), { recursive: true });
    fs.mkdirSync(path.dirname(marker), { recursive: true });
    fs.writeFileSync(settings, JSON.stringify({ statusLine: { command, padding: 2 } }));
    fs.writeFileSync(
      marker,
      JSON.stringify({
        priorStatusLineCommand: prior,
        installedStatusLineCommand: command,
        installedBy: "t",
      }),
    );
    return { repo, settings, marker };
  }
  function rewrite(
    t: { repo: string; settings: string; marker: string },
    platform: NodeJS.Platform = "win32",
    measuredSurfaces?: readonly MeasuredSurface[],
  ): { status: number; log: string } {
    const lines: string[] = [];
    const status = rewriteStatusline(
      { ...t, platform, ...(measuredSurfaces === undefined ? {} : { measuredSurfaces }) },
      (line) => lines.push(line),
    );
    return { status, log: lines.join("\n") };
  }
  const read = (file: string): Record<string, unknown> =>
    JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  const snapshot = (t: { settings: string; marker: string }) => [
    fs.readFileSync(t.settings, "utf8"),
    fs.readFileSync(t.marker, "utf8"),
  ];

  // Scenario "A framework statusline in the bare form is upgraded on Windows".
  test(
    "(e): a bare node <abs> is rewritten to the guarded form in the three ordered writes, after a backup",
    { skip: !posix },
    () => {
      const t = setup("");
      const own = `node ${SHIM(t.repo)}`;
      fs.writeFileSync(t.settings, JSON.stringify({ statusLine: { command: own, padding: 2 } }));
      fs.writeFileSync(
        t.marker,
        JSON.stringify({
          priorStatusLineCommand: "",
          installedStatusLineCommand: own,
          installedBy: "t",
        }),
      );
      const res = rewrite(t);
      assert.equal(res.status, 0, res.log);
      const guarded = `${GUARDED_PREFIX}${own}`;
      assert.deepEqual(read(t.settings)["statusLine"], { command: guarded, padding: 2 });
      assert.deepEqual(read(t.marker), {
        priorStatusLineCommand: "",
        installedStatusLineCommand: guarded,
        installedBy: "t",
      });
      assert.equal(backups(t.settings).length, 1);
      assert.match(
        res.log,
        /rewrote statusLine\.command -> set NoDefaultCurrentDirectoryInExePath=1&& node /,
      );
      assert.ok(!res.log.includes("current-directory lookup"), "empty prior: no R35 note");
    },
  );

  test(
    "(c): a bare node <abs> is left byte-identical with the R32 diagnostic, no backup",
    { skip: !posix },
    () => {
      const t = setup("");
      const own = `node ${SHIM(t.repo)}`;
      fs.writeFileSync(t.settings, JSON.stringify({ statusLine: { command: own } }));
      fs.writeFileSync(
        t.marker,
        JSON.stringify({ priorStatusLineCommand: "", installedStatusLineCommand: own }),
      );
      const before = snapshot(t);
      const res = rewrite(t, "win32", STATE_C);
      assert.equal(res.status, 0, res.log);
      assert.match(
        res.log,
        /left statusLine\.command \(antigravity statusline on Windows: .*#1392/,
      );
      assert.deepEqual(snapshot(t), before);
      assert.deepEqual(backups(t.settings), []);
    },
  );

  test(
    "(c): a guarded command is not kept as current where the module would refuse it (v1-F3)",
    { skip: !posix },
    () => {
      const t = setup("");
      const guarded = `${GUARDED_PREFIX}node ${SHIM(t.repo)}`;
      fs.writeFileSync(t.settings, JSON.stringify({ statusLine: { command: guarded } }));
      fs.writeFileSync(
        t.marker,
        JSON.stringify({ priorStatusLineCommand: "", installedStatusLineCommand: guarded }),
      );
      const before = snapshot(t);
      const res = rewrite(t, "win32", STATE_C);
      assert.ok(!res.log.includes("already the direct form"), res.log);
      assert.match(
        res.log,
        /left statusLine\.command \(antigravity statusline on Windows: .*#1392/,
      );
      assert.deepEqual(snapshot(t), before);
      assert.deepEqual(backups(t.settings), []);
    },
  );

  test(
    "(e): the guarded command is kept: nothing written, no backup (R34 keep, R22)",
    { skip: !posix },
    () => {
      const t = setup("");
      const guarded = `${GUARDED_PREFIX}node ${SHIM(t.repo)}`;
      fs.writeFileSync(t.settings, JSON.stringify({ statusLine: { command: guarded } }));
      fs.writeFileSync(
        t.marker,
        JSON.stringify({ priorStatusLineCommand: "", installedStatusLineCommand: guarded }),
      );
      const before = snapshot(t);
      const res = rewrite(t);
      assert.equal(res.status, 0, res.log);
      assert.match(res.log, /left statusLine\.command \(already the direct form\)/);
      assert.deepEqual(snapshot(t), before);
      assert.deepEqual(backups(t.settings), []);
    },
  );

  test(
    "(e): a guarded command naming a moved checkout is re-pointed from the registered path's checkout",
    { skip: !posix },
    () => {
      const t = setup("");
      // A registered path that is not physical (a symlinked checkout) rebuilds to the physical one.
      const link = path.join(path.dirname(t.repo), "link");
      fs.symlinkSync(t.repo, link);
      const registered = `${GUARDED_PREFIX}node ${SHIM(link)}`;
      fs.writeFileSync(t.settings, JSON.stringify({ statusLine: { command: registered } }));
      fs.writeFileSync(
        t.marker,
        JSON.stringify({ priorStatusLineCommand: "", installedStatusLineCommand: registered }),
      );
      const res = rewrite(t);
      assert.equal(res.status, 0, res.log);
      const rebuilt = `${GUARDED_PREFIX}node ${SHIM(t.repo)}`;
      assert.equal((read(t.settings)["statusLine"] as { command: string }).command, rebuilt);
      assert.equal(read(t.marker)["installedStatusLineCommand"], rebuilt);
      assert.equal(backups(t.settings).length, 1);
    },
  );

  // R35: the propagation note names the prior command.
  test("the upgrade names a non-empty prior command in an R35 note", { skip: !posix }, () => {
    const t = setup("", "mytool --brief");
    const own = `node ${SHIM(t.repo)}`;
    fs.writeFileSync(t.settings, JSON.stringify({ statusLine: { command: own } }));
    fs.writeFileSync(
      t.marker,
      JSON.stringify({ priorStatusLineCommand: "mytool --brief", installedStatusLineCommand: own }),
    );
    const res = rewrite(t);
    assert.equal(res.status, 0, res.log);
    assert.match(res.log, /rewrote statusLine\.command/);
    assert.ok(res.log.includes("mytool --brief"), res.log);
    assert.ok(res.log.includes("current-directory lookup"), res.log);
  });

  // Scenario "Only the framework's own guarded prefix is recognised".
  for (const variant of [
    (shim: string) => `set FOO=1&& node ${shim}`,
    (shim: string) => `set NoDefaultCurrentDirectoryInExePath=1 && node ${shim}`,
  ]) {
    test(
      `keep leaves ${JSON.stringify(variant("<shim>"))} as an unrecognised shape`,
      { skip: !posix },
      () => {
        const t = setup("");
        const command = variant(SHIM(t.repo));
        fs.writeFileSync(t.settings, JSON.stringify({ statusLine: { command } }));
        fs.writeFileSync(
          t.marker,
          JSON.stringify({ priorStatusLineCommand: "", installedStatusLineCommand: command }),
        );
        const before = snapshot(t);
        const res = rewrite(t);
        assert.match(res.log, /left statusLine\.command \(unrecognised shape\)/);
        assert.deepEqual(snapshot(t), before);
        assert.deepEqual(backups(t.settings), []);
      },
    );
  }

  test(
    "macOS and Linux leave a guarded command as an unrecognised shape (S4)",
    { skip: !posix },
    () => {
      for (const platform of ["darwin", "linux"] as const) {
        const t = setup("");
        const guarded = `${GUARDED_PREFIX}node ${SHIM(t.repo)}`;
        fs.writeFileSync(t.settings, JSON.stringify({ statusLine: { command: guarded } }));
        fs.writeFileSync(
          t.marker,
          JSON.stringify({ priorStatusLineCommand: "", installedStatusLineCommand: guarded }),
        );
        const before = snapshot(t);
        const res = rewrite(t, platform);
        assert.match(res.log, /left statusLine\.command \(unrecognised shape\)/);
        assert.deepEqual(snapshot(t), before);
      }
    },
  );

  test('macOS and Linux keep a direct node "<abs>" as before', { skip: !posix }, () => {
    const t = setup("");
    const direct = `node "${SHIM(t.repo)}"`;
    fs.writeFileSync(t.settings, JSON.stringify({ statusLine: { command: direct } }));
    fs.writeFileSync(t.marker, JSON.stringify({ installedStatusLineCommand: direct }));
    const before = snapshot(t);
    const res = rewrite(t, "linux");
    assert.match(res.log, /already the direct form/);
    assert.deepEqual(snapshot(t), before);
  });

  test("a Windows install under (c) is refused, writing nothing (R18)", { skip: !posix }, () => {
    const repo = fixtureRepo();
    const dir = path.dirname(repo);
    const lines: string[] = [];
    const status = installStatusline(
      {
        repo,
        settings: path.join(dir, "agy", "settings.json"),
        marker: path.join(dir, "usage", "state", "antigravity-statusline.json"),
        platform: "win32",
        measuredSurfaces: STATE_C,
      },
      (line) => lines.push(line),
    );
    assert.equal(status, 1);
    assert.match(lines.join("\n"), /from the directory the user starts Antigravity CLI in.*#1392/);
    assert.equal(fs.existsSync(path.join(dir, "agy", "settings.json")), false);
  });
});
