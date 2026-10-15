// service-schedule-launchd-systemd.test.ts — scripts/lib/service/schedule-{backend,launchd,systemd}.ts
// (spec 0258 requirement 15; PLAN v2 step 17): the exact verb order, no start verb, rollback,
// and an uninstall that spawns nothing when there is nothing to remove. The stubs sit behind
// CREWRIG_TEST_SERVICE_BIN_DIR and record their argv; the names are throwaway leaves and HOME
// is a temp directory, so no real job is ever registered. POSIX only.

import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { UnsupportedOsError } from "../lib/service/backend.ts";
import { setExecutableOverride } from "../lib/service/exec.ts";
import { plistPathFor } from "../lib/service/launchd.ts";
import { selectScheduleBackend } from "../lib/service/schedule-backend.ts";
import type { ScheduleBackend } from "../lib/service/schedule-backend.ts";
import { createScheduleBackend as createLaunchd } from "../lib/service/schedule-launchd.ts";
import { curatorNames } from "../lib/service/schedule-names.ts";
import { createScheduleBackend as createSystemd } from "../lib/service/schedule-systemd.ts";
import type { ScheduleSpec } from "../lib/service/schedule-spec.ts";
import { unitPathFor } from "../lib/service/systemd.ts";

const names = curatorNames("crewrig-test-schedule");
const spec: ScheduleSpec = {
  frequency: "weekly",
  hour: 9,
  nodePath: "/usr/local/bin/node",
  entry: "/repo/artifacts/skills/curate.ts",
  args: ["--auto"],
  pathValue: "/usr/bin:/bin",
  logFile: "/tmp/curator.log",
};
const daily14: ScheduleSpec = { ...spec, frequency: "daily", hour: 14 };
const STUB = `#!/bin/sh
echo "$*" >> "$FAKE_DIR/calls.log"
verb=""
for a in "$@"; do case "$a" in --user) ;; *) verb="$a"; break;; esac; done
[ -f "$FAKE_DIR/out.$verb" ] && cat "$FAKE_DIR/out.$verb"
[ -f "$FAKE_DIR/fail.$verb" ] && exit 1
exit 0
`;
const START_VERBS = /^(?:--user )?(?:start|kickstart|run|bootstrap|restart)\b/;

let dir = "";
let home = "";
const saved: Record<string, string | undefined> = {};

const set = (name: string): void => writeFileSync(path.join(dir, name), "");
function calls(): string[] {
  const file = path.join(dir, "calls.log");
  return existsSync(file) ? readFileSync(file, "utf8").trim().split("\n") : [];
}
const noStartVerb = (): void =>
  assert.deepEqual(
    calls().filter((c) => START_VERBS.test(c)),
    [],
  );

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "sched-fake-"));
  home = path.join(dir, "home");
  mkdirSync(home);
  const bin = path.join(dir, "bin");
  mkdirSync(bin);
  for (const tool of ["launchctl", "systemctl"]) {
    writeFileSync(path.join(bin, tool), STUB);
    chmodSync(path.join(bin, tool), 0o755);
  }
  for (const key of ["FAKE_DIR", "CREWRIG_TEST_SERVICE_BIN_DIR", "CREWRIG_TEST_SERVICE_PLATFORM"]) {
    saved[key] = process.env[key];
  }
  process.env["FAKE_DIR"] = dir;
  process.env["CREWRIG_TEST_SERVICE_BIN_DIR"] = bin;
});
afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(dir, { recursive: true, force: true });
});

const opts = process.platform === "win32" ? { skip: "POSIX only" } : {};

describe("selectScheduleBackend", opts, () => {
  it("selects by platform, lazily, and honours the test platform seam", async () => {
    assert.equal((await selectScheduleBackend("darwin")).kind, "launchd");
    assert.equal((await selectScheduleBackend("linux")).kind, "systemd");
    process.env["CREWRIG_TEST_SERVICE_PLATFORM"] = "linux";
    assert.equal((await selectScheduleBackend()).kind, "systemd");
    process.env["CREWRIG_TEST_SERVICE_PLATFORM"] = "freebsd";
    await assert.rejects(selectScheduleBackend(), UnsupportedOsError);
  });

  it("refuses a module that exports no conforming factory", async () => {
    await assert.rejects(
      selectScheduleBackend("darwin", () => Promise.resolve({})),
      /no createScheduleBackend/,
    );
    const wrong = (): ScheduleBackend => createSystemd(home);
    await assert.rejects(
      selectScheduleBackend("darwin", () => Promise.resolve({ createScheduleBackend: wrong })),
      /did not return a launchd backend/,
    );
  });
});

describe("launchd schedule backend", opts, () => {
  const plist = (): string => plistPathFor(names, home);

  it("install writes the plist, unloads then loads, never starts the job", () => {
    const out = createLaunchd(home).install(names, spec);
    assert.equal(out.ok, true);
    assert.deepEqual(calls(), [`unload -w ${plist()}`, `load -w ${plist()}`]);
    noStartVerb();
    const text = readFileSync(plist(), "utf8");
    assert.match(text, /StartCalendarInterval/);
    assert.doesNotMatch(text, /RunAtLoad/);
  });

  it("an ignored unload failure does not stop the load", () => {
    set("fail.unload");
    assert.equal(createLaunchd(home).install(names, spec).ok, true);
    assert.deepEqual(calls(), [`unload -w ${plist()}`, `load -w ${plist()}`]);
  });

  it("a failed load removes the plist", () => {
    set("fail.load");
    const out = createLaunchd(home).install(names, spec);
    assert.equal(out.ok, false);
    assert.equal(existsSync(plist()), false);
  });

  it("a reinstall with another hour unloads before loading and leaves only the new schedule", () => {
    const backend = createLaunchd(home);
    backend.install(names, spec);
    writeFileSync(path.join(dir, "calls.log"), "");
    assert.equal(backend.install(names, daily14).ok, true);
    assert.deepEqual(calls(), [`unload -w ${plist()}`, `load -w ${plist()}`]);
    const text = readFileSync(plist(), "utf8");
    assert.match(text, /<key>Hour<\/key>\s*<integer>14<\/integer>/);
    assert.doesNotMatch(text, /<integer>9<\/integer>|Weekday/);
    noStartVerb();
  });

  it("a failed reinstall leaves no plist behind", () => {
    const backend = createLaunchd(home);
    backend.install(names, spec);
    set("fail.load");
    assert.equal(backend.install(names, daily14).ok, false);
    assert.equal(existsSync(plist()), false);
  });

  it("uninstall: absent spawns nothing; present unloads -w and removes the file", () => {
    const backend = createLaunchd(home);
    assert.deepEqual(backend.uninstall(names), { ok: true, absent: true });
    assert.deepEqual(calls(), []);
    backend.install(names, spec);
    const out = backend.uninstall(names);
    assert.deepEqual(out, { ok: true, removedPath: plist() });
    assert.deepEqual(calls().slice(-1), [`unload -w ${plist()}`]);
    assert.equal(existsSync(plist()), false);
    noStartVerb();
  });

  it("render names the plist path and writes nothing", () => {
    const [file, ...rest] = createLaunchd(home).render(names, spec);
    assert.equal(rest.length, 0);
    assert.equal(file?.label, plist());
    assert.equal(existsSync(plist()), false);
    assert.deepEqual(calls(), []);
  });
});

describe("systemd schedule backend", opts, () => {
  const service = (): string => unitPathFor(names, home);
  const timer = (): string => path.join(path.dirname(service()), `${names.unit}.timer`);

  it("probe is `systemctl --user show-environment`", () => {
    assert.deepEqual(createSystemd(home).probe(), { ok: true });
    assert.deepEqual(calls(), ["--user show-environment"]);
    set("fail.show-environment");
    const probe = createSystemd(home).probe();
    assert.ok(!probe.ok && probe.capability === "user systemd session");
  });

  it("probe reports a missing tool", () => {
    setExecutableOverride("systemctl", "/nonexistent/systemctl");
    try {
      const probe = createSystemd(home).probe();
      assert.ok(!probe.ok && probe.capability === "user systemd session");
    } finally {
      setExecutableOverride("systemctl", null);
    }
  });

  it("install writes both units, reloads, enables the timer and starts nothing else", () => {
    const out = createSystemd(home).install(names, spec);
    assert.equal(out.ok, true);
    assert.deepEqual(calls(), ["--user daemon-reload", `--user enable --now ${names.unit}.timer`]);
    noStartVerb();
    assert.match(readFileSync(service(), "utf8"), /Type=oneshot/);
    assert.match(readFileSync(timer(), "utf8"), /OnCalendar=Mon \*-\*-\* 09:00:00/);
  });

  it("a failed enable rolls everything back", () => {
    set("fail.enable");
    const out = createSystemd(home).install(names, spec);
    assert.equal(out.ok, false);
    assert.deepEqual(calls().slice(-2), [
      `--user disable --now ${names.unit}.timer`,
      "--user daemon-reload",
    ]);
    assert.equal(existsSync(service()), false);
    assert.equal(existsSync(timer()), false);
  });

  it("a failed daemon-reload rolls back before any enable", () => {
    set("fail.daemon-reload");
    assert.equal(createSystemd(home).install(names, spec).ok, false);
    assert.equal(
      calls().some((c) => c.includes("enable")),
      false,
    );
    assert.equal(existsSync(timer()), false);
  });

  it("a reinstall with another hour disables the timer before re-enabling it", () => {
    const backend = createSystemd(home);
    backend.install(names, spec);
    writeFileSync(path.join(dir, "calls.log"), "");
    assert.equal(backend.install(names, daily14).ok, true);
    assert.deepEqual(calls(), [
      `--user disable --now ${names.unit}.timer`,
      "--user daemon-reload",
      `--user enable --now ${names.unit}.timer`,
    ]);
    const text = readFileSync(timer(), "utf8");
    assert.match(text, /OnCalendar=\*-\*-\* 14:00:00/);
    assert.doesNotMatch(text, /Mon|09:00/);
    noStartVerb();
  });

  it("a failed reinstall rolls back to a clean state", () => {
    const backend = createSystemd(home);
    backend.install(names, spec);
    set("fail.enable");
    assert.equal(backend.install(names, daily14).ok, false);
    assert.deepEqual(calls().slice(-2), [
      `--user disable --now ${names.unit}.timer`,
      "--user daemon-reload",
    ]);
    assert.equal(existsSync(service()), false);
    assert.equal(existsSync(timer()), false);
  });

  it("a failing pre-disable never fails the reinstall", () => {
    const backend = createSystemd(home);
    backend.install(names, spec);
    set("fail.disable");
    assert.equal(backend.install(names, daily14).ok, true);
    assert.match(readFileSync(timer(), "utf8"), /14:00:00/);
  });

  it("uninstall spawns nothing when the timer file is absent", () => {
    assert.deepEqual(createSystemd(home).uninstall(names), { ok: true, absent: true });
    assert.deepEqual(calls(), []);
  });

  it("uninstall disables --now, removes both files, reloads", () => {
    const backend = createSystemd(home);
    backend.install(names, spec);
    const out = backend.uninstall(names);
    assert.deepEqual(out, { ok: true, removedPath: timer() });
    assert.deepEqual(calls().slice(-2), [
      `--user disable --now ${names.unit}.timer`,
      "--user daemon-reload",
    ]);
    assert.equal(existsSync(service()), false);
    assert.equal(existsSync(timer()), false);
  });

  it("render returns the service then the timer without writing", () => {
    const files = createSystemd(home).render(names, spec);
    assert.deepEqual(
      files.map((f) => f.label),
      [service(), timer()],
    );
    assert.equal(existsSync(service()), false);
    assert.deepEqual(calls(), []);
  });
});
