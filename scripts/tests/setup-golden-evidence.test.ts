// setup-golden-evidence.test.ts — the evidence the tagged deviations must NOT hide (both legs run the
// TypeScript entry: `shell` through the forwarding shim, `ts` directly)
// (finding review/1335 i1-F17): WHICH questions a run asked, in what order, with what answer, and
// WHICH daemon requests it made. Tags (f) and (a)/(b) drop the `[answer]` echo lines and the `fzf`
// records; the question sequence compares them with each other, and the curl records (compared,
// not dropped) carry the daemon probe. Host-runnable: golden files go to a temporary directory,
// the daemon stand-in is a loopback child process, no setup is run.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

import { legDifference } from "./lib/setup-differential.ts";
import { startGoldenDaemon } from "./lib/setup-golden-daemon.ts";
import { checkGolden, writeGolden } from "./lib/setup-golden-regen.ts";
import type { CaseResult } from "./lib/setup-golden-regen.ts";
import { probeRecords } from "./lib/setup-golden-run.ts";
import type { GoldenCase } from "./lib/setup-golden-types.ts";

const base = fs.mkdtempSync(path.join(os.tmpdir(), "golden-evidence-"));
after(() => fs.rmSync(base, { recursive: true, force: true }));

const c: GoldenCase = { id: "cell", cli: "claude", note: "a unit cell" };
const ask = (header: string, answer: string, cancelled = false) => ({
  header,
  options: [answer],
  answer,
  unscripted: false,
  cancelled,
});
const BACKEND =
  "Validation backend? (internal = built-in AskUserQuestion prompt; plannotator = rich browser review, opt-in)";
const SEQTHINK = "Install Sequential Thinking MCP server?";
const TEAM = "head -20 <REPO>/config/teams/{}.md";
const MCP = { url: "http://127.0.0.1:41893/mcp", bearer: "<TOKEN>" };
const echo = (...pairs: string[]): string => pairs.map((p) => `[answer] ${p}\n`).join("");

const shell = {
  status: 0,
  stdout: "line one\nline two\n",
  stderr: "",
  tree: [],
  bakCount: {},
  fzfRecords: [ask(BACKEND, "internal"), ask(SEQTHINK, "yes"), ask(TEAM, "ATLAS")],
  curlRecords: [MCP],
} as unknown as CaseResult;
const asked = ["validation.backend=internal", "install-seqthink=yes", "catalogue.team=ATLAS"];
writeGolden("claude", "cell", shell, base);

/** A run of the cell: the recorded shell result, its stdout carrying `lines` of echo first. */
const run = (echoes: readonly string[], patch: Partial<CaseResult> = {}): CaseResult => ({
  ...shell,
  stdout: echo(...echoes) + shell.stdout,
  fzfRecords: [],
  ...patch,
});
const golden = (result: CaseResult, leg = "ts", cell = c): void =>
  checkGolden(cell, result, leg, base);
const fails = (result: CaseResult, pattern: RegExp): void => {
  assert.throws(() => golden(result), pattern);
  assert.throws(() => golden(result, "shell"), pattern);
  assert.match(legDifference(c, run(asked), result) ?? "", pattern);
};
const QUESTIONS = /questions[\s\S]*echo lines/;

describe("question sequence: the echo lines against the recorded fzf records", () => {
  test("the same questions, in order, with the same answers pass (golden and differential)", () => {
    golden(run(asked));
    golden(run(asked), "shell");
    assert.equal(legDifference(c, run(asked), run(asked)), undefined);
  });

  test("an extra question echoed that the shell never asked fails", () => {
    fails(run([...asked, "tls-delegation=no"]), QUESTIONS);
  });

  test("a missing question fails", () => {
    fails(run(asked.slice(0, 2)), QUESTIONS);
  });

  test("a different answer value fails (the shell chose X, the run answered Y)", () => {
    fails(
      run(["validation.backend=plannotator", ...asked.slice(1)]),
      /-validation\.backend=internal[\s\S]*\+validation\.backend=plannotator/,
    );
  });

  test("a different order fails", () => {
    fails(run([asked[1] ?? "", asked[0] ?? "", asked[2] ?? ""]), QUESTIONS);
  });

  test("a question echoed under the wrong id fails", () => {
    fails(run(["validation.translate=internal", ...asked.slice(1)]), QUESTIONS);
  });

  test("an fzf header outside the observed inventory can never match", () => {
    const odd = { ...shell, fzfRecords: [ask("Unheard of?", "x")] } as unknown as CaseResult;
    writeGolden("claude", "odd", odd, base);
    assert.throws(() => golden(run([]), "ts", { ...c, id: "odd" }), /\?Unheard of\?=x/);
  });

  test("a cancelled catalogue pick stands for the empty value", () => {
    const declined = { ...shell, fzfRecords: [ask(TEAM, "", true)] } as unknown as CaseResult;
    writeGolden("claude", "declined", declined, base);
    const cell = { ...c, id: "declined" };
    golden(run(["catalogue.team="]), "ts", cell);
    assert.throws(() => golden(run(["catalogue.team=ATLAS"]), "ts", cell), QUESTIONS);
  });

  test("the already tagged differences still pass: echo lines and fzf records are not compared as text", () => {
    golden(run(asked, { fzfRecords: [ask("Another?", "z")] }));
    assert.equal(
      legDifference(c, run(asked), run(asked, { fzfRecords: [ask("Another?", "z")] })),
      undefined,
    );
  });
});

describe("daemon probe: the curl records are compared, not exempted", () => {
  test("a wrong probe path fails", () => {
    fails(
      run(asked, { curlRecords: [{ ...MCP, url: "http://127.0.0.1:41893/healthz" }] }),
      /tree\.json/,
    );
  });

  test("a wrong bearer class fails", () => {
    fails(run(asked, { curlRecords: [{ ...MCP, bearer: "<PLACEHOLDER>" }] }), /tree\.json/);
    fails(run(asked, { curlRecords: [{ ...MCP, bearer: "" }] }), /tree\.json/);
  });

  test("a probe that never happened fails", () => {
    fails(run(asked, { curlRecords: [] }), /tree\.json/);
  });

  test("the stand-in records path, Host and bearer class, in order, in every mode", async () => {
    for (const probe of [0, 1, 2] as const) {
      const daemon = await startGoldenDaemon({ probe, port: "0" });
      const url = `http://127.0.0.1:${daemon.port}`;
      const call = (target: string, bearer?: string): Promise<unknown> =>
        fetch(`${url}${target}`, {
          method: target === "/mcp" ? "POST" : "GET",
          ...(bearer === undefined ? {} : { headers: { authorization: `Bearer ${bearer}` } }),
          body: target === "/mcp" ? "{}" : null,
        }).catch(() => undefined);
      await call("/healthz");
      await call("/mcp", "a-real-token");
      await call("/mcp", "crewrig-setup-placeholder-not-a-credential");
      const seen = await daemon.requests();
      assert.deepEqual(
        seen.map((r) => `${r.method} ${r.path} ${r.bearer}`),
        ["GET /healthz none", "POST /mcp real", "POST /mcp placeholder"],
        `probe mode ${probe}`,
      );
      assert.equal(seen[0]?.host, `127.0.0.1:${daemon.port}`);
    }
  });

  test("the records map onto the shell's curl records: real port shown as the fixtures' one, repeats collapsed", () => {
    const request = (bearer: "none" | "placeholder" | "real", p = "/mcp") =>
      ({
        method: p === "/mcp" ? "POST" : "GET",
        path: p,
        host: "127.0.0.1:5555",
        bearer,
      }) as const;
    assert.deepEqual(
      probeRecords(
        [request("real"), request("real"), request("none", "/healthz"), request("placeholder")],
        { actual: "5555", shown: "41893" },
      ),
      [
        MCP,
        { url: "http://127.0.0.1:41893/healthz", bearer: "" },
        { url: "http://127.0.0.1:41893/mcp", bearer: "<PLACEHOLDER>" },
      ],
    );
  });

  test("a probe made with another method, or at another path, is refused (i1-F22)", () => {
    const port = { actual: "5555", shown: "41893" };
    const at = (method: string, path: string) =>
      ({ method, path, host: "127.0.0.1:5555", bearer: "real" }) as const;
    assert.deepEqual(probeRecords([at("GET", "/healthz"), at("POST", "/mcp")], port).length, 2);
    for (const [method, path] of [
      ["GET", "/mcp"],
      ["POST", "/healthz"],
      ["HEAD", "/healthz"],
      ["POST", "/other"],
    ] as const) {
      assert.throws(
        () => probeRecords([at(method, path)], port),
        new RegExp(`unexpected daemon probe ${method} ${path}`),
      );
    }
  });
});
