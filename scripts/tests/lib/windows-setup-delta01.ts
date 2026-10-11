// windows-setup-delta01.ts — the Windows cases of delta-01 to spec 0256 (deviations (m), (n), (q)): with no
// `bash` on PATH the Claude, Gemini, Copilot and Antigravity entries name `node <home>/.crewrig/tls-exec.ts`
// and the Sequential Thinking entry wraps `npx.cmd`; `tls-exec.ts` exists before the first entry is
// registered (by call order, not by file time); no written entry names `bash`; the Chroma refusal text of
// the shell is gone (the scheduled task itself is a declared gap, see `chromaAndMessages`); the pipx
// guidance is the Windows form. The sandbox PATH holds the `.cmd` stubs, node and System32 only, so a
// `bash` on it would be a harness defect, asserted first.

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
    const marker = path.join(sb.calls, "claude.wrapper");
    const wrapperAt = path.join("%USERPROFILE%", ".crewrig", "tls-exec.ts");
    h.stub(
      sb,
      "claude",
      [
        `if exist "${wrapperAt}" >>"${marker}" echo present`,
        `if not exist "${wrapperAt}" >>"${marker}" echo absent`,
      ].join("\n"),
    );
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
    // Order by call order, never by mtime: the stub noted, at each call, whether the wrapper existed.
    const seen = h.calls(sb, "claude.wrapper");
    const all = h.calls(sb, "claude");
    assert.equal(
      seen.length,
      all.length,
      `call log and wrapper log differ: ${all.length} vs ${seen.length}`,
    );
    const first = all.findIndex((l) => /^mcp add\b/.test(l));
    assert.ok(first >= 0, "no `claude mcp add` call to order against");
    assert.equal(
      seen[first],
      "present",
      `tls-exec.ts was not installed when the first entry was registered: ${all[first]}`,
    );
  });
}

function fileEntries(
  h: Harness,
  cli: "gemini" | "copilot" | "antigravity",
  answers: string[],
): void {
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
    for (const [rel, body] of h.landed(sb)) {
      if (/(^|[\\/])tls-exec\.ts$/.test(rel)) continue; // the wrapper's own source, not an entry
      assert.ok(!/"bash(\.exe)?"|tls-exec\.sh/.test(text(body)), `${rel} names bash`);
    }
    const joined = named
      .map(([, t]) => t)
      .join("\n")
      .replaceAll("\\\\", "/");
    assert.match(joined, /"node"/, "an entry does not run through node");
    if (/sequential/i.test(joined))
      assert.match(joined, /npx\.cmd/, "the Sequential Thinking entry does not wrap npx.cmd");
  });
}

/**
 * (q) is exercised: the sandbox has no pipx, so the offer prints the guidance. (n) is NOT exercisable
 * from this job and says so: the Chroma step runs only when a MemPalace interpreter is detected, and
 * (1) the detector spawns the interpreter with no shell, which Node refuses for a `.cmd` stub
 * (`EINVAL`), so only a real `.exe` would do; (2) on win32 `executableFor` runs
 * `%SystemRoot%\\System32\\schtasks.exe` whatever PATH says (the PATH and bin-dir seams are POSIX
 * only), so a recording `schtasks.cmd` is never called and the real Task Scheduler would be driven
 * under the fixed leaf `mempalace-chroma-server`. The scheduled-task install and its rollback are
 * proved by setup-chroma-install-win.test.ts (injected backend) and by the service-windows suites
 * (real schtasks, throwaway leaf). What this job still asserts is the shell's refusal text is gone.
 */
function chromaAndMessages(h: Harness): void {
  h.check("pipx guidance is the Windows form (q)", () => {
    const sb = h.sandbox();
    const res = h.run(sb, "claude", answerArgs(swap("mempalace-install=yes")));
    expectStatus(res, 0);
    if (!/pipx not found/.test(res.out))
      return h.notExercised("(q) pipx guidance", "the run did not reach the MemPalace offer", {
        required: true,
      });
    assert.match(res.out, /scoop install pipx/, why(res, "expected the Windows pipx line"));
    assert.doesNotMatch(res.out, /brew install|python3 -m pip/, why(res, "a POSIX guidance line"));
  });
  h.check("Chroma daemon is not refused as an unsupported OS (n)", () => {
    const sb = h.sandbox();
    const res = h.run(sb, "claude", answerArgs(CLAUDE_ANSWERS));
    expectStatus(res, 0);
    // The refusal text can only be absent from a run that REACHED the Chroma step: its header is the
    // first line the installer prints. A run that never got there proves nothing about the text, so
    // it asserts nothing and reports the step as not exercised (i1-F23).
    if (/Installing shared ChromaDB HTTP daemon supervisor/.test(res.out))
      assert.doesNotMatch(
        res.out + res.err,
        /unsupported OS/,
        why(res, "the shell's Windows message survived"),
      );
    else
      h.notExercised(
        "(n) no unsupported-OS refusal",
        "the run did not reach the Chroma step (no MemPalace interpreter detected)",
      );
    h.notExercised(
      "(n) scheduled task and rollback",
      "not reachable here: no `.cmd` interpreter stub can be detected (Node refuses to spawn it) and " +
        "schtasks resolves to System32 whatever PATH holds; covered by setup-chroma-install-win.test.ts",
    );
  });
}

export function runDelta01(h: Harness): void {
  claudeEntries(h);
  fileEntries(
    h,
    "gemini",
    CLAUDE_ANSWERS.filter((a) => !/^(install-settings|install-seqthink)=/.test(a)).concat(
      "tls-delegation=yes",
    ),
  );
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
