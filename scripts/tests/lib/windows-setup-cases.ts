// windows-setup-cases.ts — the R34 cases of spec 0256 for the `windows-setup-entries` job: a run driven
// only by `--answer`, piped standard input with CRLF line ends and a byte-order mark, closed standard
// input (exit 2 and the fail-closed diagnostic), the TLS opt-in file read back by both readers, `--link`
// with the link-or-copy seam forced to refuse, no carriage return in any file a setup wrote (scan scoped
// to the landing zones, never AppData), and no file mode asserted (deviation (p)).

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { productionClosure, REPO } from "./build-fixture-tree.ts";
import { collectFiles } from "./extension-run.ts";
import { FORCED_REFUSAL_ENV } from "../../lib/link-or-copy-classify.ts";
import { readTlsEnv } from "../../lib/tls-env.ts";
import type { Harness, Run, Sandbox } from "./windows-setup-proof.ts";
import { expectStatus, why } from "./windows-proof-support.ts";

/** The base `--answer` list of a Claude run: an answer for every question the sandbox run asks (no existing rules, no TLS bundle, no MemPalace, no overlay tiers, no legacy MCP entry). */
export const CLAUDE_ANSWERS: readonly string[] = [
  "validation.backend=internal",
  "validation.translate=off",
  "validation.pedagogy=contextual",
  "validation.illustration=off",
  "install-seqthink=no",
  "install-settings=no",
  "catalogue.team=ATLAS",
  "catalogue.expertise=SOFTWARE-ARCHITECT",
  "catalogue.level=EXPERT",
  "transcripts=no",
  "usage-capture=no",
];

/** `["--answer", "a=b", ...]` for each `id=value`, plus extra flags. Pure. */
export function answerArgs(answers: readonly string[], extra: readonly string[] = []): string[] {
  return [...extra, ...answers.flatMap((a) => ["--answer", a])];
}

/** The aggregated failure report. Pure. */
export function formatReport(failures: readonly string[], notes: readonly string[]): string {
  const list = failures.map((f, i) => `${i + 1}. ${f}`).join("\n");
  const head = `windows-setup-proof: FAILED: ${failures.length} failure(s)\n${list}`;
  return notes.length === 0
    ? head
    : `${head}\nnot exercised:\n${notes.map((n) => `  - ${n}`).join("\n")}`;
}

/** The production closure of `node_modules`, copied once, that the `npm ci` stub puts in a sandbox repo. */
let fixture: string | undefined;

/** Remove the fixture copy of the production packages. */
export function disposeFixture(): void {
  if (fixture !== undefined) fs.rmSync(fixture, { recursive: true, force: true });
}

export function npmFixture(): string {
  if (fixture !== undefined) return fixture;
  const dir = fs.mkdtempSync(
    path.join(fs.realpathSync(process.env["RUNNER_TEMP"] ?? os.tmpdir()), "setup-npm-"),
  );
  for (const name of productionClosure())
    fs.cpSync(path.join(REPO, "node_modules", name), path.join(dir, name), {
      recursive: true,
      dereference: true,
    });
  return (fixture = dir);
}

export function buildRepo(repo: string): void {
  fs.copyFileSync(path.join(REPO, "package-lock.json"), path.join(repo, "package-lock.json"));
  const identity = /[\\/]config[\\/](SOUL|PROFILE)\.md$/;
  const cp = (rel: string, filter?: (src: string) => boolean): void =>
    fs.cpSync(path.join(REPO, rel), path.join(repo, rel), {
      recursive: true,
      dereference: true,
      ...(filter ? { filter } : {}),
    });
  cp("config", (src) => !identity.test(src));
  cp("hooks");
  cp("artifacts/core");
  for (const name of ["SOUL", "PROFILE"])
    fs.copyFileSync(
      path.join(REPO, `config/${name}.md.template`),
      path.join(repo, `config/${name}.md`),
    );
}

const without = (...ids: string[]): string[] =>
  CLAUDE_ANSWERS.filter((a) => !ids.some((id) => a.startsWith(`${id}=`)));

/** No landed file holds a carriage return: the scan the install proof makes, on this entry's landing zones. */
export function noCarriageReturn(h: Harness, sb: Sandbox): void {
  const files = h.landed(sb);
  assert.ok(files.size > 0, "the run landed no file in any landing zone");
  for (const [rel, bytes] of files)
    assert.ok(!bytes.includes(13), `${rel} holds a carriage return`);
}

/** The deployed rules and the validation backend file of a finished run (the same on every case that completes). */
function assertLanded(h: Harness, sb: Sandbox, res: Run): void {
  expectStatus(res, 0);
  const files = [...h.landed(sb).keys()];
  assert.ok(
    files.some((f) => f.startsWith(".claude/rules/")),
    `no rule deployed: ${files.join(", ")}`,
  );
  assert.ok(files.includes(".crewrig/validation.conf"), `no validation.conf: ${files.join(", ")}`);
}

function answerOnly(h: Harness): void {
  h.check("an --answer-only run of the Claude entry", () => {
    const sb = h.sandbox();
    const res = h.run(sb, "claude", answerArgs(CLAUDE_ANSWERS));
    assertLanded(h, sb, res);
    assert.ok(
      h.calls(sb, "npm").some((l) => /^ci --omit=dev --workspaces=false\b/.test(l)),
      why(res, "npm ci argv"),
    );
    assert.doesNotMatch(res.err, /not asked/, why(res, "an answer was left unused"));
    noCarriageReturn(h, sb);
  });
}

/** Piped input: a byte-order mark, then CRLF line ends. Run through cmd.exe, whose pipe reaches the child natively. */
function pipedInput(h: Harness): void {
  h.check("piped standard input with a BOM and CRLF", () => {
    const sb = h.sandbox();
    const lines = ["internal", "off", "contextual", "off", "no", "no"];
    const input = Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from(lines.join("\r\n") + "\r\n"),
    ]);
    const res = h.run(
      sb,
      "claude",
      answerArgs(
        without(
          "validation.backend",
          "validation.translate",
          "validation.pedagogy",
          "validation.illustration",
          "install-seqthink",
          "install-settings",
        ),
      ),
      { shell: "cmd", input },
    );
    assertLanded(h, sb, res);
    const conf = fs.readFileSync(path.join(sb.home, ".crewrig", "validation.conf"), "utf8");
    assert.match(conf, /^backend=internal$/m, why(res, "the BOM or the CR leaked into an answer"));
    noCarriageReturn(h, sb);
  });
}

function closedInput(h: Harness): void {
  h.check("closed standard input fails closed with exit 2", () => {
    const sb = h.sandbox();
    const res = h.run(sb, "claude", answerArgs(without("validation.backend")));
    expectStatus(res, 2);
    assert.match(
      res.out + res.err,
      /validation\.backend/,
      why(res, "the diagnostic must name the question"),
    );
    assert.ok(
      !fs.existsSync(path.join(sb.home, ".crewrig", "validation.conf")),
      "the validation backend is not recorded after the refusal",
    );
  });
}

function tlsOptIn(h: Harness): void {
  h.check("the TLS opt-in file is read back by both readers", () => {
    const sb = h.sandbox();
    const bundle = path.join(sb.root, "ca-bundle.pem");
    fs.writeFileSync(bundle, "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n");
    const res = h.run(sb, "claude", answerArgs([...CLAUDE_ANSWERS, "tls-delegation=yes"]), {
      env: { SSL_CERT_FILE: bundle },
    });
    assertLanded(h, sb, res);
    const read = readTlsEnv(sb.home); // reader 1: the TypeScript reader of the setup
    assert.equal(read.kind, "ok", `tls-env.sh read back as ${JSON.stringify(read)}`);
    const wrapper = path.join(sb.home, ".crewrig", "tls-exec.ts"); // reader 2: the installed trust wrapper
    assert.ok(fs.existsSync(wrapper), "the trust wrapper is not installed");
    const child = h.exec(sb, [
      process.execPath,
      wrapper,
      process.execPath,
      "-e",
      "process.stdout.write(process.env.SSL_CERT_FILE ?? '')",
    ]);
    assert.equal(child.out.trim(), bundle, why(child, "the wrapper did not export the bundle"));
    noCarriageReturn(h, sb);
  });
}

function linkRefused(h: Harness): void {
  h.check("--link with the link-or-copy seam forced to refuse", () => {
    const sb = h.sandbox();
    const args = answerArgs(CLAUDE_ANSWERS, ["--link"].concat(["--answer", "link-confirm=yes"]));
    const res = h.run(sb, "claude", args, { env: { [FORCED_REFUSAL_ENV]: "EPERM" } });
    expectStatus(res, 0);
    assert.match(
      res.out + res.err,
      /EPERM|refused|cop(y|ied)/i,
      why(res, "no notice of the fallback copy"),
    );
    for (const [rel] of h.landed(sb)) assert.ok(rel.length > 0);
    noCarriageReturn(h, sb);
  });
}

export function runCases(h: Harness): void {
  answerOnly(h);
  pipedInput(h);
  closedInput(h);
  tlsOptIn(h);
  linkRefused(h);
  // Deviation (p): no file mode is set on win32, so none is asserted here or anywhere in this proof.
}

export function landed(sb: Sandbox): Map<string, Buffer> {
  const all = new Map<string, Buffer>();
  const zones: Array<[string, string]> = [".claude", ".gemini", ".copilot", ".crewrig"].map((z) => [
    path.join(sb.home, z),
    z,
  ]);
  zones.push([path.join(sb.repo, ".crewrig-state"), "repo/.crewrig-state"]);
  for (const [dir, label] of zones)
    if (fs.existsSync(dir))
      for (const [rel, bytes] of collectFiles(dir)) {
        if (rel.split("/").some((part) => part.toLowerCase() === "appdata")) continue; // PowerShell's own CRLF data
        all.set(`${label}/${rel}`, bytes);
      }
  return all;
}
