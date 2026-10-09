// history-import-harness.ts — the shared scaffolding of the history-import end-to-end tests
// (spec 0253 R27, the `windows-history-import` job): a temporary home, the fake `mempalace`
// package (fake-mempalace.ts), the real Python, and the helpers that spawn an entry as
// `process.execPath <entry>.ts` (no bash, no shell, no `.cmd`) and read the fake's log.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { createFakeMempalace, fakeEnv, findPython } from "./fake-mempalace.ts";
import type { FakeMempalace } from "./fake-mempalace.ts";

const SCRIPTS = path.resolve(import.meta.dirname, "..", "..");
const QUIET = "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON";

export interface Run {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly out: string[];
  readonly err: string[];
}

const lines = (text: string): string[] => text.split(/\r?\n/).filter((l) => l !== "");

export class Harness {
  work = "";
  home = "";
  /** An existing, empty directory: a PATH with no interpreter in it. */
  emptyPath = "";
  python = "";
  fake: FakeMempalace = { dir: "", logFile: "" };
  private counter = 0;

  /** Call from `before`. */
  setup(): void {
    const found = findPython();
    assert.ok(
      found !== undefined,
      "no Python on the PATH: the windows-history-import CI job provisions one with actions/setup-python",
    );
    this.python = found;
    this.work = fs.mkdtempSync(path.join(os.tmpdir(), "history-import-py-"));
    this.home = path.join(this.work, "home");
    this.emptyPath = path.join(this.work, "empty-path");
    fs.mkdirSync(this.home);
    fs.mkdirSync(this.emptyPath);
    this.fake = createFakeMempalace(this.work);
  }

  /** Call from `after`. */
  teardown(): void {
    fs.rmSync(this.work, { recursive: true, force: true });
  }

  /** A fresh case directory; the fake's log is emptied so each case reads only its own calls. */
  fresh(): string {
    fs.rmSync(this.fake.logFile, { force: true });
    this.counter += 1;
    const dir = path.join(this.work, `case-${this.counter}`);
    fs.mkdirSync(dir);
    return dir;
  }

  /** The explicit child environment over the real Python and the fake package. */
  env(extra: Record<string, string> = {}, exit = 0, drawers?: string): NodeJS.ProcessEnv {
    return fakeEnv({ home: this.home, fake: this.fake, exit, drawers, extra });
  }

  /** The same environment with an empty PATH: no interpreter anywhere. */
  envNoPython(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
    return fakeEnv({ home: this.home, fake: this.fake, pathDir: this.emptyPath, extra });
  }

  run(name: string, entry: string, args: string[], env: NodeJS.ProcessEnv, input = ""): Run {
    const argv = [QUIET, path.join(SCRIPTS, entry), ...args];
    const start = performance.now();
    const r = spawnSync(process.execPath, argv, { env, encoding: "utf8", input, timeout: 120_000 });
    console.log(`timing: ${name} ${Math.round(performance.now() - start)} ms`);
    assert.equal(r.error, undefined, `${name}: spawn failed: ${String(r.error)}`);
    return {
      status: r.status,
      stdout: r.stdout,
      stderr: r.stderr,
      out: lines(r.stdout),
      err: lines(r.stderr),
    };
  }

  private readLog(): Record<string, unknown>[] {
    if (!fs.existsSync(this.fake.logFile)) return [];
    return lines(fs.readFileSync(this.fake.logFile, "utf8")).map((l) => {
      const parsed: unknown = JSON.parse(l);
      assert.ok(typeof parsed === "object" && parsed !== null, `log line: ${l}`);
      return parsed as Record<string, unknown>;
    });
  }

  /** The argv of every `mempalace mine` call the fake logged, in order. */
  mineArgv(): string[][] {
    return this.readLog().flatMap((e) => {
      const argv = e["argv"];
      return Array.isArray(argv) ? [argv.map(String)] : [];
    });
  }

  /** The drawer ids the fake was asked to delete, in order. */
  deletedIds(): string[] {
    return this.readLog().flatMap((e) => (typeof e["deleted"] === "string" ? [e["deleted"]] : []));
  }
}
