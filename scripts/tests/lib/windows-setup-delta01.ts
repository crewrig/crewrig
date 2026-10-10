// windows-setup-delta01.ts — the Windows cases of delta-01 to spec 0256 (deviations (m), (n), (q)): with no
// `bash` on PATH the Claude, Copilot and Antigravity entries name `node <home>/.crewrig/tls-exec.ts` and
// the Sequential Thinking entry wraps `npx.cmd`; `tls-exec.ts` exists before the first entry is written;
// no written entry names `bash`; the Chroma daemon is a scheduled task (no `unsupported OS`, rolled back
// on failure); the pipx guidance is the Windows form. The sandbox PATH holds the `.cmd` stubs, node and
// System32 only, so a `bash` on it would be a harness defect, asserted first.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { answerArgs, CLAUDE_ANSWERS } from "./windows-setup-cases.ts";
import type { Harness, Sandbox } from "./windows-setup-proof.ts";
import { expectStatus, sandboxPath, why } from "./windows-proof-support.ts";

const text = (bytes: Buffer): string => bytes.toString("utf8");
const swap = (...pairs: string[]): string[] =>
  CLAUDE_ANSWERS.filter((a) => !pairs.some((p) => a.startsWith(`${p.split("=")[0]}=`))).concat(
    pairs,
  );

/** A bundle file and the environment that makes the setup offer (and, with the answer, write) the TLS trust file. */
function tlsEnv(sb: Sandbox): Record<string, string> {
  const bundle = path.join(sb.root, "ca-bundle.pem");
  fs.writeFileSync(bundle, "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n");
  return { SSL_CERT_FILE: bundle };
}

function noBashOnPath(h: Harness, sb: Sandbox): void {
  // System32 holds `bash.exe` on a runner (the WSL launcher) and cannot be taken off PATH: what the entries
  // write must not name it, which the cases assert below; only the directories we control are checked here.
  const dirs = sandboxPath(sb.bin)
    .split(path.delimiter)
    .filter((dir) => !/[\\/]system32$/i.test(dir));
  for (const dir of dirs)
    for (const name of ["bash.exe", "bash.cmd", "bash"])
      assert.ok(!fs.existsSync(path.join(dir, name)), `${name} found in ${dir}`);
  void h;
}

/** Every written file that names the wrapper, with its text (not the wrapper's own source). */
function wrapperFiles(h: Harness, sb: Sandbox): Array<[string, string]> {
  return [...h.landed(sb)]
    .map(([rel, bytes]): [string, string] => [rel, text(bytes)])
    .filter(
      ([rel, t]) =>
        t.includes("tls-exec") && !/(^|\/)tls-exec\.ts$/.test(rel.replaceAll("\\", "/")),
    );
}

function claudeEntries(h: Harness): void {
  h.check("Claude: Sequential Thinking names node tls-exec.ts and npx.cmd", () => {
    const sb = h.sandbox();
    noBashOnPath(h, sb);
    const res = h.run(
      sb,
      "claude",
      answerArgs(swap("install-seqthink=yes", "tls-delegation=yes")),
      { env: tlsEnv(sb) },
    );
    expectStatus(res, 0);
    const wrapper = path.join(sb.home, ".crewrig", "tls-exec.ts");
    assert.ok(fs.existsSync(wrapper), "tls-exec.ts is not installed");
    const add = h.calls(sb, "claude").filter((l) => /^mcp add\b/.test(l));
    assert.ok(add.length > 0, why(res, "no `claude mcp add` call was recorded"));
    const thinking = add.find((l) => /sequential/i.test(l));
    assert.ok(thinking !== undefined, `no Sequential Thinking registration in: ${add.join(" | ")}`);
    assert.ok(
      /\bnode\b/.test(thinking) && thinking.replaceAll("\\", "/").includes(".crewrig/tls-exec.ts"),
      `wrapper not named: ${thinking}`,
    );
    assert.ok(/npx\.cmd/.test(thinking), `npx.cmd not named: ${thinking}`);
    for (const line of add)
      assert.ok(!/\bbash\b|tls-exec\.sh/.test(line), `an entry names bash: ${line}`);
    assert.ok(
      fs.statSync(wrapper).mtimeMs <= fs.statSync(path.join(sb.calls, "claude")).mtimeMs,
      "tls-exec.ts was installed after the first entry",
    );
  });
}

function fileEntries(h: Harness, cli: "copilot" | "antigravity", answers: string[]): void {
  h.check(`${cli}: written MCP entries name node tls-exec.ts, never bash`, () => {
    const sb = h.sandbox();
    noBashOnPath(h, sb);
    const res = h.run(sb, cli, answerArgs(answers), { env: tlsEnv(sb) });
    expectStatus(res, 0);
    assert.ok(
      fs.existsSync(path.join(sb.home, ".crewrig", "tls-exec.ts")),
      why(res, "tls-exec.ts is not installed"),
    );
    const named = wrapperFiles(h, sb);
    assert.ok(named.length > 0, why(res, "no written file names the trust wrapper"));
    for (const [rel, body] of h.landed(sb))
      assert.ok(!/"bash(\.exe)?"|tls-exec\.sh/.test(text(body)), `${rel} names bash`);
    const joined = named
      .map(([, t]) => t)
      .join("\n")
      .replaceAll("\\\\", "/");
    assert.match(joined, /"node"/, "an entry does not run through node");
    if (/sequential/i.test(joined))
      assert.match(joined, /npx\.cmd/, "the Sequential Thinking entry does not wrap npx.cmd");
  });
}

/** (n) and (q): reached only when the MemPalace layer runs; a case not reached is reported, never silently passed. */
function chromaAndMessages(h: Harness): void {
  h.check("pipx guidance is the Windows form (q)", () => {
    const sb = h.sandbox();
    const res = h.run(sb, "claude", answerArgs(swap("mempalace-install=yes")));
    expectStatus(res, 0);
    if (!/pipx not found/.test(res.out))
      return h.notExercised("(q) pipx guidance", "the run did not reach the MemPalace offer");
    assert.match(res.out, /scoop install pipx/, why(res, "expected the Windows pipx line"));
    assert.doesNotMatch(res.out, /brew install|python3 -m pip/, why(res, "a POSIX guidance line"));
  });
  h.check("Chroma daemon is a scheduled task (n), rolled back on failure", () => {
    const sb = h.sandbox();
    h.stub(sb, "schtasks");
    const ok = h.run(sb, "claude", answerArgs(CLAUDE_ANSWERS));
    assert.doesNotMatch(
      ok.out + ok.err,
      /unsupported OS/,
      why(ok, "the shell's Windows message survived"),
    );
    if (h.calls(sb, "schtasks").length === 0)
      return h.notExercised(
        "(n) schtasks",
        "no MemPalace in range in the sandbox: the Chroma step was not reached",
      );
    assert.ok(
      h.calls(sb, "schtasks").some((l) => /\/create/i.test(l)),
      "no /Create call recorded",
    );
    const bad = h.sandbox();
    h.stub(bad, "schtasks", 'if /i "%1"=="/Create" exit /b 1');
    const failed = h.run(bad, "claude", answerArgs(CLAUDE_ANSWERS));
    expectStatus(failed, 1);
    assert.match(
      failed.err + failed.out,
      /ERROR:/,
      why(failed, "expected the install's ERROR lines"),
    );
  });
}

export function runDelta01(h: Harness): void {
  claudeEntries(h);
  fileEntries(
    h,
    "copilot",
    CLAUDE_ANSWERS.filter(
      (a) => !/^(legacy-mcp-removal|install-settings|install-seqthink|profile-method)=/.test(a),
    )
      .concat("tls-delegation=yes")
      .filter((a, i, all) => all.lastIndexOf(a) === i && !(a === "tls-delegation=no")),
  );
  fileEntries(
    h,
    "antigravity",
    CLAUDE_ANSWERS.filter(
      (a) => !/^(legacy-mcp-removal|install-settings|install-seqthink)=/.test(a),
    )
      .concat("install-seqthink=yes", "tls-delegation=yes")
      .filter((a) => a !== "tls-delegation=no"),
  );
  chromaAndMessages(h);
}
