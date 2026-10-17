// mempalace-doctor-report.test.ts — what the doctor reports per machine shape (spec 0263,
// PR E; ports G2, G3, G4, G7, G8, G10 of the retired test-mempalace-doctor.sh): a clean
// machine and its per-source fields (G2), an empty machine (G3), a dist-info / __version__
// disagreement (G4), a deleted wrapper (G7), an interpreter with no distribution (G8), and a
// run that mutates nothing (G10). POSIX only.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import {
  COMPARATOR,
  GOOD_VERSION,
  HAS_PACKAGING,
  PIN,
  PIN_MODULE,
  POSIX,
  fieldLine,
  hasLine,
  makeAbsentInterpreter,
  makeCheckout,
  makeConsoleScript,
  makeFakesite,
  makeInterpreter,
  makeToolbin,
  probeDist,
  runDoctor,
  runDoctorIsolated,
  scratchDir,
  writeRegBash,
  writeRegDirect,
  type DoctorRun,
} from "./lib/doctor-machine.ts";
import { realHomeGuard } from "./lib/real-home-guard.ts";

const skip = POSIX ? false : "sh-shim interpreters and shebang console scripts are POSIX only";
const guard = realHomeGuard();
const roots: string[] = [];
const root = (label: string): string => {
  const dir = scratchDir(label);
  roots.push(dir);
  return dir;
};
const wrapperOf = (checkout: string): string =>
  path.join(checkout, "scripts", "lib", "mempalace-http-wrapper.py");
const pipxPy = (home: string): string =>
  path.join(home, ".local", "pipx", "venvs", "mempalace", "bin", "python");

after(() => {
  for (const dir of roots) fs.rmSync(dir, { recursive: true, force: true });
  guard.assertUnchanged();
});

interface Clean {
  readonly home: string;
  readonly pathDir: string;
  readonly run: DoctorRun;
}

/** The four CLI registrations on one interpreter at candidate 1, and both console scripts. */
function cleanMachine(label: string, dist: string, attr: string): Clean {
  const s = root(label);
  const home = path.join(s, "home");
  const pathDir = path.join(s, "bin");
  makeFakesite(path.join(s, "site"), dist, attr);
  const py = pipxPy(home);
  makeInterpreter(py, path.join(s, "site"));
  makeCheckout(path.join(s, "checkout"));
  const wrapper = wrapperOf(path.join(s, "checkout"));
  writeRegBash(path.join(home, ".claude.json"), py, wrapper);
  writeRegDirect(path.join(home, ".gemini", "settings.json"), py, wrapper);
  writeRegDirect(path.join(home, ".copilot", "mcp-config.json"), py, wrapper);
  writeRegBash(path.join(home, ".gemini", "config", "mcp_config.json"), py, wrapper);
  makeConsoleScript(path.join(pathDir, "mempalace"), py);
  makeConsoleScript(path.join(pathDir, "mempalace-mcp"), py);
  return { home, pathDir, run: runDoctor(home, pathDir) };
}

function manifest(dir: string): string[] {
  const rows: string[] = [];
  const walk = (d: string): void => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) {
        const sha = createHash("sha256").update(fs.readFileSync(p)).digest("hex");
        rows.push(`${sha}  ${p}`);
      }
    }
  };
  walk(dir);
  return rows.sort();
}

describe("G2: a clean machine", { skip }, () => {
  let clean: Clean;
  before(() => {
    clean = cleanMachine("g2", GOOD_VERSION, GOOD_VERSION);
  });
  const range = `>=${PIN.min},<${PIN.maxExclusive}`;

  test("exits 0, no fallback, no GUARD ABSENT, no divergence", () => {
    const { rc, out } = clean.run;
    const excerpt = out
      .split("\n")
      .filter((l) => l.includes("NOT OK"))
      .join("\n");
    assert.equal(rc, 0, excerpt || out);
    for (const text of ["fallback selected:", "GUARD ABSENT", "DIVERGE"]) {
      assert.ok(!out.includes(text), `unexpected ${text}`);
    }
  });

  test("names the selection, the restart sentence and the successful outcome", () => {
    for (const text of [
      "selection:",
      "must be restarted",
      "OK — every source reports the same MemPalace version",
    ]) {
      assert.ok(clean.run.out.includes(text), `missing ${text}`);
    }
  });

  const fields: [string, string][] = [
    ["version served:", `${GOOD_VERSION}  (dist-info, resolved in-process)`],
    ["mempalace.__version__:", `${GOOD_VERSION}  (agrees with dist-info)`],
    ["supported range:", range],
    ["verdict:", `IN_RANGE version=${GOOD_VERSION} range=${range} comparator=${COMPARATOR}`],
    ["packaging importable:", HAS_PACKAGING],
  ];
  for (const [label, value] of fields) {
    test(`reports the per-source field "${label}" as a whole line`, () => {
      assert.ok(hasLine(clean.run.out, fieldLine(label, value)), `no line for ${label} ${value}`);
    });
  }

  test("G10: a second run leaves every file under HOME byte-identical", () => {
    const before = manifest(clean.home);
    runDoctor(clean.home, clean.pathDir);
    assert.deepEqual(manifest(clean.home), before);
    assert.ok(before.length >= 4, "the manifest covers the four registrations");
  });
});

describe("G3: an empty machine", { skip }, () => {
  let r: DoctorRun;
  before(() => {
    const s = root("g3");
    const toolbin = path.join(s, "toolbin");
    fs.mkdirSync(path.join(s, "home"), { recursive: true });
    fs.mkdirSync(path.join(s, "bin"), { recursive: true });
    makeToolbin(toolbin);
    r = runDoctorIsolated(path.join(s, "home"), path.join(s, "bin"), toolbin);
  });

  test("exits non-zero and reports absence, not errors", () => {
    assert.notEqual(r.rc, 0, r.out);
    for (const text of ["NOT PRESENT", "ABSENT — not on PATH", "must be restarted"]) {
      assert.ok(r.out.includes(text), `missing ${text}`);
    }
  });

  test("names the registration files it read", () => {
    assert.ok(r.out.includes("Files consulted for this section"));
  });
});

describe("G4: a dist-info / __version__ disagreement", { skip }, () => {
  const dist = `${PIN.min}.post1`;
  let r: DoctorRun;
  before(() => {
    r = cleanMachine("g4", dist, PIN.min).run;
  });

  test("is reported, with the reason it is not a fault", () => {
    assert.ok(r.out.includes(`DISAGREES with dist-info ${dist}`));
    assert.ok(r.out.includes("a .postN rebuild disagrees legitimately"));
  });

  test("is neither a divergence across sources nor a non-zero outcome", () => {
    assert.ok(!r.out.includes("DIVERGE"));
    const excerpt = r.out
      .split("\n")
      .filter((l) => l.includes("NOT OK"))
      .join("\n");
    assert.equal(r.rc, 0, excerpt || r.out);
  });
});

describe("G7: a registered wrapper that no longer exists", { skip }, () => {
  let r: DoctorRun;
  let wrapper = "";
  before(() => {
    const s = root("g7");
    const home = path.join(s, "home");
    const toolbin = path.join(s, "toolbin");
    fs.mkdirSync(path.join(s, "bin"), { recursive: true });
    makeToolbin(toolbin);
    makeCheckout(path.join(s, "checkout"));
    wrapper = wrapperOf(path.join(s, "checkout"));
    makeFakesite(path.join(s, "site"), GOOD_VERSION);
    const py = pipxPy(home);
    makeInterpreter(py, path.join(s, "site"));
    writeRegBash(path.join(home, ".claude.json"), py, wrapper);
    fs.rmSync(wrapper);
    r = runDoctorIsolated(home, path.join(s, "bin"), toolbin);
  });

  test("fixture: the wrapper is gone while its scripts/lib directory survives", () => {
    assert.ok(fs.statSync(path.dirname(wrapper)).isDirectory());
    assert.ok(!fs.existsSync(wrapper));
  });

  test("is WRAPPER MISSING, names the path, is not evaluated, and fails the run", () => {
    assert.ok(r.out.includes(`WRAPPER MISSING — ${wrapper}`), r.out);
    assert.ok(!r.out.includes("guard status:"));
    assert.notEqual(r.rc, 0, r.out);
  });
});

describe("G8: an interpreter that resolves no mempalace distribution", { skip }, () => {
  let r: DoctorRun;
  let absent = "";
  before(() => {
    const s = root("g8");
    const home = path.join(s, "home");
    const toolbin = path.join(s, "toolbin");
    fs.mkdirSync(path.join(s, "bin"), { recursive: true });
    makeToolbin(toolbin);
    makeFakesite(path.join(s, "site"), GOOD_VERSION);
    // Candidate 1 pins section 3 to a known in-range interpreter.
    makeInterpreter(pipxPy(home), path.join(s, "site"));
    absent = path.join(s, "no-mempalace-here", "python-absent");
    makeAbsentInterpreter(absent);
    makeCheckout(path.join(s, "checkout"));
    writeRegBash(path.join(home, ".claude.json"), absent, wrapperOf(path.join(s, "checkout")));
    r = runDoctorIsolated(home, path.join(s, "bin"), toolbin);
  });

  test("fixture: absence is proved, not assumed (dist=absent)", () => {
    assert.equal(probeDist(absent), "absent", PIN_MODULE);
  });

  test("exits non-zero and reports the absence as its own whole lines", () => {
    assert.notEqual(r.rc, 0, r.out);
    const want = [
      fieldLine("version served:", "absent  (dist-info, resolved in-process)"),
      fieldLine("verdict:", "NO VERSION — this interpreter resolves no mempalace distribution"),
      `  - Claude Code: no mempalace version is resolvable from ${absent}`,
    ];
    for (const line of want) assert.ok(hasLine(r.out, line), `no line exactly '${line}'`);
  });

  test("claims nothing else: no range failure, no range verdict, no divergence", () => {
    for (const text of ["lies outside", "OUT_OF_RANGE", "DIVERGE"]) {
      assert.ok(!r.out.includes(text), `unexpected ${text}`);
    }
  });

  test("the absent version is the only finding", () => {
    assert.ok(hasLine(r.out, "  NOT OK — 1 finding(s):"), r.out);
  });
});
