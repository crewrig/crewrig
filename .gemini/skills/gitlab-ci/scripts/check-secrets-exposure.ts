// check-secrets-exposure.ts — flag patterns in a GitLab CI pipeline that may leak secrets into job
// logs or widen the secret blast radius (the TypeScript entry of check-secrets-exposure.sh; same
// text scan, same output).
//
// Usage: node check-secrets-exposure.ts <pipeline-file-or-directory>
//
// Five checks, run in order on every line (one line may report several findings):
//   1. a credential-named key set to an inline literal in `variables:` or a shell assignment;
//   2. a well-known token shape (GitLab, GitHub, AWS) or a PEM private-key header as a literal;
//   3. `echo` / `printf` of a credential-named variable;
//   4. `set -x` / `set +x`, shell xtrace;
//   5. `CI_DEBUG_TRACE` enabled.
// Directory mode scans `<dir>/.gitlab-ci.yml` plus any YAML under `<dir>/.gitlab/`.
//
// Exit: 0 clean or nothing to scan, 1 a finding or a bad target, 2 usage.
//
// Self-contained on purpose: one file, no import, runs under any package type (spec 0258).

process.removeAllListeners("warning");

void (async () => {
  const fs = process.getBuiltinModule("node:fs");
  const path = process.getBuiltinModule("node:path");
  await Promise.resolve();

  const tty = process.stdout.isTTY === true;
  const RED = tty ? "\u001b[0;31m" : "";
  const GREEN = tty ? "\u001b[0;32m" : "";
  const YELLOW = tty ? "\u001b[0;33m" : "";
  const RESET = tty ? "\u001b[0m" : "";

  // Output is collected as latin1 text (file content is read as latin1) and written as bytes; a
  // path is re-expressed as its UTF-8 bytes so it survives the round trip.
  const out: string[] = [];
  const err: string[] = [];
  const bytes = (s: string): string => Buffer.from(s, "utf8").toString("latin1");
  const flush = (): void => {
    if (out.length > 0) process.stdout.write(Buffer.from(out.join(""), "latin1"));
    if (err.length > 0) process.stderr.write(Buffer.from(err.join(""), "latin1"));
  };

  const name = path.basename(process.argv[1] ?? "check-secrets-exposure.ts");
  const args = process.argv.slice(2);
  if (args.length !== 1) {
    err.push(`Usage: ${name} <pipeline-file-or-directory>\n`);
    process.exitCode = 2;
    flush();
    return;
  }
  const target = args[0] ?? "";

  const kindOf = (p: string): "dir" | "file" | "none" => {
    try {
      const st = fs.statSync(p);
      return st.isDirectory() ? "dir" : st.isFile() ? "file" : "none";
    } catch {
      return "none";
    }
  };

  // find -type f under a directory: lstat enumeration, symlinked files and directories skipped.
  const walk = (dir: string, acc: string[]): void => {
    let names: string[];
    try {
      names = fs.readdirSync(dir);
    } catch {
      return;
    }
    for (const n of names) {
      const p = `${dir}/${n}`;
      const st = fs.lstatSync(p, { throwIfNoEntry: false });
      if (st === undefined) continue;
      if (st.isDirectory()) walk(p, acc);
      else if (st.isFile() && (n.endsWith(".yml") || n.endsWith(".yaml"))) acc.push(p);
    }
  };

  const files: string[] = [];
  const targetKind = kindOf(target);
  if (targetKind === "dir") {
    if (kindOf(`${target}/.gitlab-ci.yml`) === "file") files.push(`${target}/.gitlab-ci.yml`);
    const sub = `${target}/.gitlab`;
    if (kindOf(sub) === "dir" && !fs.lstatSync(sub).isSymbolicLink()) {
      const found: string[] = [];
      walk(sub, found);
      found.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
      files.push(...found);
    }
  } else if (targetKind === "file") {
    files.push(target);
  } else {
    err.push(`${RED}[FAIL] not a file or directory: ${bytes(target)}${RESET}\n`);
    process.exitCode = 1;
    flush();
    return;
  }
  if (files.length === 0) {
    out.push(`no GitLab pipeline file found under: ${bytes(target)}\n`);
    flush();
    return;
  }

  const WS = "[ \\t\\n\\v\\f\\r]";
  const KEY =
    "(SECRET|TOKEN|PASSWORD|PASSWD|API_?KEY|ACCESS_?KEY|PRIVATE_?KEY|CREDENTIAL|AUTH|PASSPHRASE)";
  const ASSIGN = new RegExp(
    `^(export${WS}+)?[A-Za-z0-9_]*${KEY}[A-Za-z0-9_]*${WS}*[:=]${WS}*([^]+)$`,
  );
  const GITLAB_PAT = /glpat-[A-Za-z0-9_-]{20}/;
  const GITHUB_TOKEN = /(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}/;
  const AWS_KEY_ID = /AKIA[0-9A-Z]{16}/;
  const PEM_HEADER = new RegExp(`BEGIN${WS}[^]*PRIVATE${WS}KEY`);
  const PRINTS = new RegExp(`(echo|printf)${WS}[^]*\\$\\{?[A-Za-z0-9_]*${KEY}`);
  const XTRACE = new RegExp(`(^|[^A-Za-z0-9_])set${WS}+[-+]x(${WS}|$)`);
  const DEBUG_TRACE = new RegExp(`CI_DEBUG_TRACE${WS}*:?=?${WS}*["']?(true|1)["']?`);
  const LTRIM = /^[ \t\n\v\f\r]+/;
  const TRIM = /^[ \t\n\v\f\r]+|[ \t\n\v\f\r]+$/g;

  let violations = 0;
  const report = (file: string, lineno: number, pattern: string, risk: string): void => {
    out.push(`${RED}[RISK]${RESET} ${bytes(file)}:${String(lineno)}: ${pattern}\n`);
    out.push(`       ${YELLOW}why:${RESET} ${bytes(risk)}\n`);
    violations += 1;
  };

  for (const f of files) {
    let text: string;
    try {
      text = fs.readFileSync(f, "latin1").replaceAll("\0", "");
    } catch {
      err.push(`${name}: ${bytes(f)}: cannot read the file\n`);
      process.exitCode = 1;
      flush();
      return;
    }
    const lines = text.split("\n");
    if (lines[lines.length - 1] === "") lines.pop();
    lines.forEach((line, i) => {
      const lineno = i + 1;

      // Leading whitespace, then ONE leading list dash, so `- export TOKEN=...` reads as a shell
      // assignment too.
      let probe = line.replace(LTRIM, "");
      if (probe.startsWith("- ")) probe = probe.slice(2);

      // 1. A credential-named key with an inline literal value.
      const assign = ASSIGN.exec(probe);
      if (assign !== null) {
        let val = ((assign[3] ?? "").split("#")[0] ?? "").replace(TRIM, "");
        if (val.endsWith('"')) val = val.slice(0, -1);
        if (val.startsWith('"')) val = val.slice(1);
        if (val.endsWith("'")) val = val.slice(0, -1);
        if (val.startsWith("'")) val = val.slice(1);
        const skipped =
          val === "" ||
          val.startsWith("$") ||
          val.startsWith("!reference") ||
          val.startsWith("&") ||
          val.startsWith("*");
        if (!skipped) {
          report(
            f,
            lineno,
            "hardcoded value for a credential-named key",
            "a secret committed in the pipeline is readable by anyone with repo access — move it to a masked + protected CI/CD variable",
          );
        }
      }

      // 2. Well-known token shapes as literals.
      if (
        GITLAB_PAT.test(line) ||
        GITHUB_TOKEN.test(line) ||
        AWS_KEY_ID.test(line) ||
        PEM_HEADER.test(line)
      ) {
        report(
          f,
          lineno,
          "literal access token / private key",
          "a recognizable credential literal is committed in the pipeline — revoke it and store it as a masked + protected CI/CD variable",
        );
      }

      // 3. echo / printf of a credential-named variable.
      if (PRINTS.test(line)) {
        report(
          f,
          lineno,
          "echo/printf of a credential-named variable",
          "printing a secret to the job log persists it in the log; masking is best-effort and a transformed value bypasses it",
        );
      }

      // 4. set -x / set +x, shell xtrace.
      if (XTRACE.test(line)) {
        report(
          f,
          lineno,
          "set -x / set +x",
          "shell xtrace prints every expanded command, including secret variable values",
        );
      }

      // 5. CI_DEBUG_TRACE enabled.
      if (DEBUG_TRACE.test(line)) {
        report(
          f,
          lineno,
          "CI_DEBUG_TRACE enabled",
          "debug trace logs every variable in the job, including masked and protected ones",
        );
      }
    });
  }

  if (violations === 0) {
    out.push(`${GREEN}[OK]${RESET} no secret-exposure patterns detected\n`);
  } else {
    err.push(`${RED}${String(violations)} risky pattern(s) found${RESET}\n`);
    process.exitCode = 1;
  }
  flush();
})();
