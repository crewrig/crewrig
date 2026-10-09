// fake-schtasks.ts — a stand-in `schtasks` for the tests of scripts/lib/service/schtasks.ts.
// A Node script with a shebang, so it runs where the tests run it (not on
// Windows, where the tests that use it are skipped). It keeps its tasks and a
// call log in a directory, so a test reads exact argument lists back.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setExecutableOverride } from "../../lib/service/exec.ts";

const SCRIPT = `#!/usr/bin/env node
const fs = require("fs"), path = require("path");
const dir = process.env.FAKE_SCHTASKS_DIR;
const a = process.argv.slice(2);
fs.appendFileSync(path.join(dir, "log.jsonl"), JSON.stringify(a) + "\\n");
const modeFile = path.join(dir, "mode.json");
const mode = fs.existsSync(modeFile) ? JSON.parse(fs.readFileSync(modeFile, "utf8")) : {};
const task = a[a.indexOf("/TN") + 1] || "";
const store = path.join(dir, "t_" + Buffer.from(task).toString("hex"));
const decode = (b) => (b[0] === 0xff && b[1] === 0xfe ? b.subarray(2).toString("utf16le") : b.toString("utf8"));
const say = (text, code) => { (code ? process.stderr : process.stdout).write(text); process.exit(code); };
const none = mode.noText || "ERREUR : Le fichier specifie est introuvable.\\n";
switch (a[0]) {
  case "/Query":
    if (!fs.existsSync(store)) say(none, 1);
    say(a.includes("/XML") ? fs.readFileSync(store, "utf8") : "Name Status\\nPret En cours d'execution\\n", 0);
    break;
  case "/Create": {
    if (mode.createFail) say(mode.createFail, 1);
    const file = a[a.indexOf("/XML") + 1];
    const bytes = fs.readFileSync(file);
    fs.appendFileSync(path.join(dir, "creates.jsonl"), JSON.stringify({ mode: fs.statSync(file).mode & 0o777, bom: bytes[0] === 0xff && bytes[1] === 0xfe }) + "\\n");
    fs.writeFileSync(store, decode(bytes));
    say("SUCCESS\\n", 0);
    break;
  }
  case "/Delete":
    if (!fs.existsSync(store)) say(none, 1);
    fs.rmSync(store);
    say("SUCCESS\\n", 0);
    break;
  case "/Run":
    if (mode.runFail) say("ERREUR : Acces refuse.\\n", 1);
    say("SUCCESS\\n", 0);
    break;
  case "/End":
    say("SUCCESS\\n", 0);
    break;
  case "/Change":
    if (mode.changeFail) say("ERREUR : Acces refuse.\\n", 1);
    say("SUCCESS\\n", 0);
    break;
  default:
    say("ERROR: Invalid syntax.\\n", 1);
}
`;

export interface FakeSchtasks {
  readonly dir: string;
  /** Every call's argument list, in order. */
  calls(): string[][];
  /** The mode (0600 bit, BOM) of every file handed to `/Create`. */
  creates(): { mode: number; bom: boolean }[];
  seed(task: string, xml: string): void;
  has(task: string): boolean;
  setMode(mode: Record<string, unknown>): void;
  cleanup(): void;
}

function lines(file: string): unknown[] {
  return fs.existsSync(file)
    ? fs
        .readFileSync(file, "utf8")
        .split("\n")
        .filter((l) => l !== "")
        .map((l) => JSON.parse(l) as unknown)
    : [];
}

export function installFakeSchtasks(): FakeSchtasks {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fake-schtasks-"));
  const exe = path.join(dir, "schtasks.cjs");
  fs.writeFileSync(exe, SCRIPT, { mode: 0o755 });
  setExecutableOverride("schtasks", exe);
  process.env["FAKE_SCHTASKS_DIR"] = dir;
  const store = (task: string): string => path.join(dir, `t_${Buffer.from(task).toString("hex")}`);
  return {
    dir,
    calls: () => lines(path.join(dir, "log.jsonl")) as string[][],
    creates: () => lines(path.join(dir, "creates.jsonl")) as { mode: number; bom: boolean }[],
    seed: (task, xml) => fs.writeFileSync(store(task), xml),
    has: (task) => fs.existsSync(store(task)),
    setMode: (mode) => fs.writeFileSync(path.join(dir, "mode.json"), JSON.stringify(mode)),
    cleanup: () => {
      setExecutableOverride("schtasks", null);
      delete process.env["FAKE_SCHTASKS_DIR"];
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
