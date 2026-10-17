// mempalace-doctor-launch.test.ts — ports G9 and G11 of the retired test-mempalace-doctor.sh
// (spec 0263, PR E): every CLI's launch path names the wrapper, the doctor carries no pin
// bound literal (G9, all platforms), and a running daemon beside stdio registrations is
// reported as a lockout (G11, POSIX only: it runs the doctor through its bash shim).
// The pin-literal scan reads the TypeScript doctor (scripts/doctor-mempalace.ts and
// scripts/lib/service/doctor-*.ts), not the 14-line shell shim.

import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { after, before, describe, test } from "node:test";
import {
  PIN,
  POSIX,
  REPO,
  WRAPPER,
  freePortSync,
  makeCheckout,
  makeFakesite,
  makeInterpreter,
  GOOD_VERSION,
  makeConsoleScript,
  runDoctor,
  scratchDir,
  writeRegBash,
  writeRegDirect,
} from "./lib/doctor-machine.ts";
import { realHomeGuard } from "./lib/real-home-guard.ts";

const guard = realHomeGuard();
const WRAPPER_REF = "scripts/lib/mempalace-http-wrapper.py";
const PRINT = path.join(REPO, "scripts", "tests", "lib", "print-setup-declarations.ts");
const NODE_FLAGS = ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON"];

after(() => guard.assertUnchanged());

function declaration(cli: string): Map<string, string> {
  const r = spawnSync(process.execPath, [...NODE_FLAGS, PRINT, cli], { encoding: "utf8" });
  assert.equal(r.status, 0, `${cli}: empty declaration (vacuity guard): ${r.stderr}`);
  const facts = new Map<string, string>();
  for (const line of r.stdout.split("\n")) {
    const eq = line.indexOf("=");
    if (eq > 0 && !facts.has(line.slice(0, eq))) facts.set(line.slice(0, eq), line.slice(eq + 1));
  }
  return facts;
}

function countRefs(file: string): number {
  return fs.readFileSync(path.join(REPO, file), "utf8").split(WRAPPER_REF).length - 1;
}

describe("G9 every CLI's launch path names the wrapper (R11)", () => {
  const carriers: ReadonlyArray<readonly [string, string]> = [
    ["claude", "setup"],
    ["antigravity", "setup"],
    ["gemini", "config/gemini/settings.json"],
    ["copilot", "config/copilot/mcp-config.json.template"],
  ];
  for (const [cli, carrier] of carriers) {
    test(`${cli} declares the wrapper as its launcher, carried by ${carrier}`, () => {
      const facts = declaration(cli);
      const script = facts.get("mcp.wrapper-script") ?? "<absent>";
      assert.ok(script.endsWith(`/${WRAPPER_REF}`), `launcher '${script}'`);
      assert.equal(facts.get("mcp.wrapper-carrier"), carrier);
    });
  }

  for (const file of ["config/gemini/settings.json", "config/copilot/mcp-config.json.template"]) {
    test(`${file} (a carrier) names the wrapper exactly once`, () => {
      assert.equal(countRefs(file), 1);
    });
  }

  test("the shared wrapper references the guard module", () => {
    assert.ok(fs.readFileSync(WRAPPER, "utf8").includes("mempalace_pin"));
  });

  test("the doctor carries neither pin bound as a literal", () => {
    const files = [
      path.join(REPO, "scripts", "doctor-mempalace.ts"),
      ...fs
        .readdirSync(path.join(REPO, "scripts", "lib", "service"))
        .filter((n) => /^doctor-.*\.ts$/.test(n))
        .map((n) => path.join(REPO, "scripts", "lib", "service", n)),
    ];
    assert.ok(files.length >= 7, `scan vacuity guard: only ${files.length} doctor files`);
    for (const bound of [PIN.min, PIN.maxExclusive]) {
      assert.ok(bound.length > 0, "empty bound");
      for (const file of files) {
        const text = fs.readFileSync(file, "utf8"); // a read failure throws: no vacuous pass
        assert.ok(!text.includes(bound), `bound literal '${bound}' present in ${file}`);
      }
    }
  });
});

describe("G11 half-converted lockout detection (spec 0172 R3)", { skip: !POSIX }, () => {
  let root = "";
  let server: ChildProcess | undefined;
  let port = 0;

  before(async () => {
    root = scratchDir("launch");
    port = freePortSync();
    const code =
      "require('node:http').createServer((q,r)=>{r.writeHead(200);r.end('OK');})" +
      ".listen(Number(process.argv[1]),'127.0.0.1',()=>console.log('ready'));";
    server = spawn(process.execPath, ["-e", code, String(port)], {
      stdio: ["ignore", "pipe", "inherit"],
    });
    await new Promise<void>((resolve, reject) => {
      server?.stdout?.once("data", () => resolve());
      server?.once("error", reject);
      server?.once("exit", () => reject(new Error("fake daemon exited early")));
    });
  });
  after(() => {
    server?.kill();
    if (root !== "") fs.rmSync(root, { recursive: true, force: true });
  });

  test("stdio registrations beside a running daemon exit non-zero and say LOCKED OUT", () => {
    const home = path.join(root, "home");
    const pathDir = path.join(root, "bin");
    makeFakesite(path.join(root, "site"), GOOD_VERSION);
    const py = path.join(home, ".local", "pipx", "venvs", "mempalace", "bin", "python");
    makeInterpreter(py, path.join(root, "site"));
    makeCheckout(path.join(root, "checkout"));
    const wrapper = path.join(root, "checkout", "scripts", "lib", "mempalace-http-wrapper.py");
    writeRegBash(path.join(home, ".claude.json"), py, wrapper);
    writeRegDirect(path.join(home, ".gemini", "settings.json"), py, wrapper);
    writeRegDirect(path.join(home, ".copilot", "mcp-config.json"), py, wrapper);
    writeRegBash(path.join(home, ".gemini", "config", "mcp_config.json"), py, wrapper);
    makeConsoleScript(path.join(pathDir, "mempalace"), py);
    makeConsoleScript(path.join(pathDir, "mempalace-mcp"), py);
    const { rc, out } = runDoctor(home, pathDir, { MEMPALACE_MCP_PORT: String(port) });
    assert.notEqual(rc, 0, "doctor exited 0 with a running daemon conflict");
    assert.ok(out.includes("LOCKED OUT BY RUNNING DAEMON"), out);
  });
});
