// setup-tls-offer.test.ts — offerTlsDelegation (scripts/lib/setup/tls-offer.ts) in a temporary HOME.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import { SetupExit } from "../lib/setup/exit.ts";
import type { PromptSession, Question } from "../lib/setup/prompt.ts";
import { TLS_QUESTION_HEADER, offerTlsDelegation } from "../lib/setup/tls-offer.ts";
import { readTlsEnv, tlsEnvPath } from "../lib/tls-env.ts";

let home: string;
let out: string[];
let asked: Question[];

beforeEach(() => {
  home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "setup-tls-offer-")));
  out = [];
  asked = [];
});
afterEach(() => fs.rmSync(home, { recursive: true, force: true }));

const session = (answer: string | undefined): PromptSession => ({
  choose: async (q) => (asked.push(q), answer),
  confirm: async () => answer,
  close: () => undefined,
});
const ctx = (env: Record<string, string | undefined>) => ({
  io: { out: (l: string) => out.push(l), err: () => undefined, errRaw: () => undefined },
  env,
  home,
});
const fakeFs = (files: string[], anchors: boolean) => ({
  isFile: (p: string) => files.includes(p),
  readdir: (d: string) =>
    anchors && d === "/usr/local/share/ca-certificates" ? ["corp.crt"] : undefined,
});
const bundle = "/tmp/corp ca/$bundle.pem";
const envFile = () => tlsEnvPath(home);
const offer = (
  env: Record<string, string | undefined>,
  answer?: string,
  files: string[] = [bundle],
) =>
  offerTlsDelegation({
    ctx: ctx(env),
    session: session(answer),
    deps: { fs: fakeFs(files, true) },
  });

describe("TLS_DELEGATION bypass", () => {
  it("off returns at once: no prompt, no output, nothing written", async () => {
    const result = await offer({ TLS_DELEGATION: "off" });
    assert.deepEqual(result, { wrote: false, vars: {} });
    assert.deepEqual(out, []);
    assert.deepEqual(asked, []);
    assert.equal(fs.existsSync(envFile()), false);
  });

  it("an invalid value prints the error on stdout and exits with status 1", async () => {
    await assert.rejects(offer({ TLS_DELEGATION: "maybe" }), (e: unknown) => {
      assert.ok(e instanceof SetupExit);
      assert.equal(e.status, 1);
      return true;
    });
    assert.deepEqual(out, ["  ERROR: invalid TLS_DELEGATION 'maybe' (want: on|off)"]);
    assert.equal(fs.existsSync(envFile()), false);
  });

  it("on skips detection and prompt and writes with the pinned bundle", async () => {
    const result = await offerTlsDelegation({
      ctx: ctx({ TLS_DELEGATION: "on", TLS_DELEGATION_CA: bundle }),
      session: session(undefined),
      deps: {
        fs: { isFile: (p) => p === bundle, readdir: () => assert.fail("detection must not run") },
      },
    });
    assert.equal(result.wrote, true);
    assert.deepEqual(asked, []);
    assert.equal(result.vars["SSL_CERT_FILE"], bundle);
  });
});

describe("detection and question", () => {
  it("offers nothing when no custom-trust context is detected", async () => {
    const result = await offerTlsDelegation({
      ctx: ctx({}),
      session: session("yes"),
      deps: { fs: fakeFs([bundle], false) },
    });
    assert.deepEqual(result, { wrote: false, vars: {} });
    assert.deepEqual(out, []);
    assert.deepEqual(asked, []);
  });

  it("asks the tls-delegation question after the lead-in lines", async () => {
    await offer({ HTTPS_PROXY: "http://p" }, "no");
    assert.deepEqual(out.slice(0, 3), [
      "",
      "Custom certificate trust (spec 0084):",
      "  Your environment looks like it sits behind a custom or corporate",
    ]);
    assert.equal(out[3], "  certificate authority (a TLS-intercepting gateway or a private CA).");
    assert.deepEqual(asked, [
      {
        id: "tls-delegation",
        header: TLS_QUESTION_HEADER,
        options: ["no", "yes"],
        cancel: "decline",
      },
    ]);
    assert.equal(
      TLS_QUESTION_HEADER,
      "Configure the framework's tools to trust your system CA for its network operations? (never disables TLS verification; writes only ~/.crewrig/tls-env.sh)",
    );
  });

  for (const answer of ["no", undefined]) {
    it(`declines on ${String(answer)}: skipped line, nothing written, existing file untouched`, async () => {
      fs.mkdirSync(path.dirname(envFile()), { recursive: true });
      fs.writeFileSync(envFile(), "# mine\n");
      const result = await offer({ SSL_CERT_FILE: bundle }, answer);
      assert.deepEqual(result, { wrote: false, vars: {} });
      assert.equal(out.at(-1), "  TLS delegation skipped — nothing written.");
      assert.equal(fs.readFileSync(envFile(), "utf8"), "# mine\n");
    });
  }

  it("declining on a fresh home creates nothing", async () => {
    await offer({ SSL_CERT_FILE: bundle }, "no");
    assert.equal(fs.existsSync(path.join(home, ".crewrig")), false);
  });
});

describe("no bundle found", () => {
  it("prints the runbook guidance and writes nothing", async () => {
    const result = await offer({ HTTPS_PROXY: "http://p" }, "yes", []);
    assert.deepEqual(result, { wrote: false, vars: {} });
    assert.deepEqual(out.slice(-5), [
      "  Could not locate a certificate bundle to delegate trust to.",
      "  Trust was NOT configured, and no verification-disabling setting was",
      "  applied. See docs/runbooks/custom-ca-tls-trust.md to configure it",
      "  manually (e.g. export CREWRIG_TLS_CA=/path/to/corporate-ca.pem, then",
      "  re-run setup).",
    ]);
    assert.equal(fs.existsSync(envFile()), false);
  });
});

describe("consent", () => {
  it("writes the file, prints the confirmation and the block with a four-space indent", async () => {
    const result = await offer({ SSL_CERT_FILE: bundle }, "yes");
    const file = envFile();
    const content = fs.readFileSync(file, "utf8");
    assert.equal(result.wrote, true);
    const start = out.indexOf("  Custom CA trust configured -> " + file);
    assert.deepEqual(out.slice(start, start + 7), [
      `  Custom CA trust configured -> ${file}`,
      `  Delegated to CA bundle: ${bundle}`,
      "  Applied for this setup run and, via scripts/lib/tls-exec.sh, for the",
      "  framework's runtime paths (MCP servers, the ChromaDB daemon).",
      `  Your shell profile was NOT modified. Remove with: rm ${file}`,
      "",
      "  Exact configuration written:",
    ]);
    assert.deepEqual(
      out.slice(start + 7),
      content
        .trimEnd()
        .split("\n")
        .map((l) => `    ${l}`),
    );
    assert.equal(out.at(-1), "    export UV_SYSTEM_CERTS=true");
  });

  it("returns the variables the reader parses from the file", async () => {
    const result = await offer({ SSL_CERT_FILE: bundle }, "yes");
    assert.deepEqual(result.vars, {
      NODE_EXTRA_CA_CERTS: bundle,
      SSL_CERT_FILE: bundle,
      REQUESTS_CA_BUNDLE: bundle,
      PIP_CERT: bundle,
      GIT_SSL_CAINFO: bundle,
      CURL_CA_BUNDLE: bundle,
      UV_SYSTEM_CERTS: "true",
    });
  });

  it("does not mutate the environment it is given", async () => {
    const env = { SSL_CERT_FILE: bundle };
    await offerTlsDelegation({
      ctx: ctx(env),
      session: session("yes"),
      deps: { fs: fakeFs([bundle], false) },
    });
    assert.deepEqual(env, { SSL_CERT_FILE: bundle });
    assert.equal(process.env["UV_SYSTEM_CERTS"] === "true", false);
  });

  it("TLS_DELEGATION_CA and CREWRIG_TLS_CA pin the bundle (the former first)", async () => {
    const files = ["/a.pem", "/b.pem"];
    const result = await offer(
      { TLS_DELEGATION: "on", CREWRIG_TLS_CA: "/b.pem", TLS_DELEGATION_CA: "/a.pem" },
      "yes",
      files,
    );
    assert.equal(result.vars["SSL_CERT_FILE"], "/a.pem");
  });

  it("the file read by readTlsEnv carries the bundle", async () => {
    await offer({ SSL_CERT_FILE: bundle }, "yes");
    const back = readTlsEnv(home);
    assert.equal(back.kind, "ok");
    if (back.kind === "ok") assert.equal(back.vars["NODE_EXTRA_CA_CERTS"], bundle);
  });

  it("replaces an existing file on consent", async () => {
    fs.mkdirSync(path.dirname(envFile()), { recursive: true });
    fs.writeFileSync(envFile(), "# old\n");
    await offer({ SSL_CERT_FILE: bundle }, "yes");
    assert.match(fs.readFileSync(envFile(), "utf8"), /^# crewrig custom root-CA/);
  });

  it("a file the reader rejects is fatal and nothing is applied", async () => {
    const badWriter = (h: string) => {
      const file = tlsEnvPath(h);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, "not a trust file\n");
      return { path: file, content: "not a trust file\n" };
    };
    await assert.rejects(
      offerTlsDelegation({
        ctx: ctx({ SSL_CERT_FILE: bundle }),
        session: session("yes"),
        deps: { fs: fakeFs([bundle], false), write: badWriter },
      }),
      /reader rejects it \(malformed\)/,
    );
    assert.equal(
      out.some((l) => l.includes("Custom CA trust configured")),
      false,
    );
  });
});
