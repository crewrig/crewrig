// check-secrets-exposure.ts — flag patterns in a CI definition that may leak secrets into logs or
// widen their blast radius. One engine, two profiles: `github` (GitHub Actions workflows) and
// `gitlab` (GitLab CI pipelines), each keeping its own patterns, messages, usage, discovery and
// write style so that each platform answers as its former script did.
// Usage: node scripts/check-secrets-exposure.ts --platform <github|gitlab> <file-or-directory>
// Exit: 0 clean or nothing to scan, 1 a finding or a bad target, 2 usage. No --json, no exit 3.
// Copied byte for byte into github-actions and gitlab-ci: only the line marked
// `crewrig:default-platform` differs. Self-contained: one file, no import.

process.removeAllListeners("warning");

void (() => {
  const fs = process.getBuiltinModule("node:fs");
  const path = process.getBuiltinModule("node:path");
  const defaultPlatform = (): string | undefined => "github"; // crewrig:default-platform

  const tty = process.stdout.isTTY === true;
  const [RED, GREEN, YELLOW, RESET] = tty
    ? ["\u001b[0;31m", "\u001b[0;32m", "\u001b[0;33m", "\u001b[0m"]
    : ["", "", "", ""];
  /** Bytes of a UTF-8 string, held as a latin1 string (the files are read as latin1). */
  const u = (s: string): string => Buffer.from(s, "utf8").toString("latin1");
  const argv = process.argv.slice(2);
  const base = path.basename(process.argv[1] ?? "check-secrets-exposure.ts");
  const SP = "[ \\t\\n\\v\\f\\r]";
  const WS = "[ \\t\\n\\v\\f\\r]";
  type Report = (file: string, line: number, pattern: string, risk: string) => void;
  type Walk = (dir: string, acc: string[]) => void;

  const github = {
    arg: "workflow-file-or-directory",
    buffered: false,
    helpAnywhere: true,
    self: () => u(process.argv[1]?.split(/[\\/]/).pop() ?? ""),
    help: (self: string) =>
      `Usage: ${self} <workflow-file-or-directory>\n\nFlags patterns that may leak secrets into logs or widen their blast radius.\nExit codes: 0 nothing found, 1 finding, 2 usage error.\n`,
    empty: "no workflow files found under",
    discover: (target: string, walk: Walk) => {
      const files: string[] = [];
      let start = `${target}/.github/workflows`;
      if (!fs.statSync(start, { throwIfNoEntry: false })?.isDirectory()) start = target;
      if (fs.lstatSync(start).isDirectory()) walk(start, files);
      return files.sort((a, b) => Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8")));
    },
    read: (f: string) => fs.readFileSync(f).toString("latin1"),
    fail: (e: unknown, _f: string, self: string) =>
      `${self}: ${e instanceof Error ? u(e.message) : String(e)}\n`,
    scan: (f: string, rows: string[], report: Report) => {
      const echoRe = new RegExp(`echo${SP}[^]*\\$\\{\\{${SP}*secrets\\.`);
      const envRe = new RegExp(`^env:${SP}*$`);
      const nonIndentRe = new RegExp(`^[^ \\t\\n\\v\\f\\r#]`);
      const secretRe = new RegExp(`\\$\\{\\{${SP}*secrets\\.`);
      const setRe = new RegExp(`(^|[^A-Za-z0-9_])set${SP}+[-+]x(${SP}|$)`);
      const jsonRe = new RegExp(`toJSON\\(${SP}*secrets${SP}*\\)`);
      let inEnv = false;
      let envLine = 0;
      let sawEnv = false;
      rows.forEach((line, i) => {
        const lineno = i + 1;
        const r = (pattern: string, risk: string, at = lineno): void =>
          report(f, at, pattern, risk);
        if (echoRe.test(line))
          r(
            "echo ${{ secrets.* }}",
            "secret value is written to stdout and persisted in the run log",
          );
        if (envRe.test(line) && !sawEnv) {
          inEnv = true;
          envLine = lineno;
          sawEnv = true;
        } else if (inEnv && lineno > envLine) {
          if (nonIndentRe.test(line)) inEnv = false;
          else if (secretRe.test(line)) {
            const why =
              "secrets defined at workflow level are inherited by every job (broad blast radius)";
            r("top-level env: references ${{ secrets.* }}", why, envLine);
            inEnv = false;
          }
        }
        if (setRe.test(line))
          r(
            "set -x / set +x",
            "shell xtrace prints every expanded command, including secret env values",
          );
        if (jsonRe.test(line))
          r(
            "toJSON(secrets)",
            "serializes the entire secrets context — any later echo, env, or file write leaks them all",
          );
      });
    },
  };

  const gitlab: typeof github = {
    arg: "pipeline-file-or-directory",
    buffered: true,
    helpAnywhere: false,
    self: () => base,
    help: (name) => `Usage: node scripts/${name} <pipeline-file-or-directory>
       node scripts/${name} --help

Flags patterns in a GitLab CI pipeline that may leak secrets into job logs: a credential-named
key set to an inline literal, a recognizable token shape or PEM private-key header, echo or printf
of a credential-named variable, set -x, and CI_DEBUG_TRACE. A text scan: no live GitLab, no
network. Directory mode scans <dir>/.gitlab-ci.yml plus the YAML under <dir>/.gitlab/.

Exit codes (legacy): 0 clean or nothing to scan, 1 a finding or a missing target, 2 usage error.
This script has no --json option and does not use exit 3.
`,
    empty: "no GitLab pipeline file found under",
    discover: (target, walk) => {
      const files: string[] = [];
      if (fs.statSync(`${target}/.gitlab-ci.yml`, { throwIfNoEntry: false })?.isFile())
        files.push(`${target}/.gitlab-ci.yml`);
      const sub = `${target}/.gitlab`;
      if (
        fs.statSync(sub, { throwIfNoEntry: false })?.isDirectory() &&
        !fs.lstatSync(sub).isSymbolicLink()
      ) {
        const found: string[] = [];
        walk(sub, found);
        files.push(...found.sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))));
      }
      return files;
    },
    read: (f) => fs.readFileSync(f, "latin1").replaceAll("\0", ""),
    fail: (_e, f, name) => `${name}: ${u(f)}: cannot read the file\n`,
    scan: (f, lines, report) => {
      const KEY =
        "(SECRET|TOKEN|PASSWORD|PASSWD|API_?KEY|ACCESS_?KEY|PRIVATE_?KEY|CREDENTIAL|AUTH|PASSPHRASE)";
      const ASSIGN = new RegExp(
        `^(export${WS}+)?[A-Za-z0-9_]*${KEY}[A-Za-z0-9_]*${WS}*[:=]${WS}*([^]+)$`,
      );
      const PEM_HEADER = new RegExp(`BEGIN${WS}[^]*PRIVATE${WS}KEY`);
      const PRINTS = new RegExp(`(echo|printf)${WS}[^]*\\$\\{?[A-Za-z0-9_]*${KEY}`);
      const XTRACE = new RegExp(`(^|[^A-Za-z0-9_])set${WS}+[-+]x(${WS}|$)`);
      const DEBUG_TRACE = new RegExp(`CI_DEBUG_TRACE${WS}*:?=?${WS}*["']?(true|1)["']?`);
      const TRIM = /^[ \t\n\v\f\r]+|[ \t\n\v\f\r]+$/g;
      lines.forEach((line, i) => {
        const r = (pattern: string, risk: string): void => report(f, i + 1, pattern, risk);
        // One leading list dash is dropped so `- export TOKEN=...` reads as an assignment.
        let probe = line.replace(/^[ \t\n\v\f\r]+/, "");
        if (probe.startsWith("- ")) probe = probe.slice(2);
        const assign = ASSIGN.exec(probe);
        if (assign !== null) {
          const val = ((assign[3] ?? "").split("#")[0] ?? "").replace(TRIM, "");
          const bare = val.replace(/"$/, "").replace(/^"/, "").replace(/'$/, "").replace(/^'/, "");
          if (bare !== "" && !["$", "!reference", "&", "*"].some((x) => bare.startsWith(x)))
            r(
              "hardcoded value for a credential-named key",
              "a secret committed in the pipeline is readable by anyone with repo access — move it to a masked + protected CI/CD variable",
            );
        }
        const shape =
          /glpat-[A-Za-z0-9_-]{20}|(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}|AKIA[0-9A-Z]{16}/;
        if (shape.test(line) || PEM_HEADER.test(line))
          r(
            "literal access token / private key",
            "a recognizable credential literal is committed in the pipeline — revoke it and store it as a masked + protected CI/CD variable",
          );
        if (PRINTS.test(line))
          r(
            "echo/printf of a credential-named variable",
            "printing a secret to the job log persists it in the log; masking is best-effort and a transformed value bypasses it",
          );
        if (XTRACE.test(line))
          r(
            "set -x / set +x",
            "shell xtrace prints every expanded command, including secret variable values",
          );
        if (DEBUG_TRACE.test(line))
          r(
            "CI_DEBUG_TRACE enabled",
            "debug trace logs every variable in the job, including masked and protected ones",
          );
      });
    },
  };

  const PROFILES: Record<string, typeof github | undefined> = { github, gitlab };
  const ENGINE_USAGE = `Usage: node scripts/${base} --platform <github|gitlab> <file-or-directory>
       node scripts/${base} --help

Flags patterns in a CI definition that may leak secrets into logs or widen their blast radius:
literal credentials and token shapes, echoed secrets, set -x, CI_DEBUG_TRACE (gitlab), workflow-level
env: secrets and toJSON(secrets) (github). A text scan: no live forge, no network.
  --platform github   a workflow file, or a directory (its .github/workflows when it exists)
  --platform gitlab   a pipeline file, or <dir>/.gitlab-ci.yml plus the YAML under <dir>/.gitlab/
--platform is required in this copy; github-actions and gitlab-ci ship the same engine with their
own platform as the default. Exit codes (legacy): 0 clean or nothing to scan, 1 a finding or a
missing target, 2 usage error. This script has no --json option and does not use exit 3.
`;

  // Take --platform <value> / --platform=<value> out of the arguments; help wins over validation.
  let value: string | undefined;
  let given = 0;
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] ?? "";
    if (a === "--platform") {
      given += 1;
      value = argv[++i];
    } else if (a.startsWith("--platform=")) {
      given += 1;
      value = a.slice("--platform=".length);
    } else rest.push(a);
  }
  const dflt = PROFILES[defaultPlatform() ?? ""];
  const usageError = (msg: string): void => {
    process.stderr.write(`${base}: ${msg}\n`);
    process.exitCode = 2;
  };
  const helpAnywhere = given > 0 || dflt?.helpAnywhere === true;
  if (helpAnywhere ? argv.includes("--help") : argv.length === 1 && argv[0] === "--help") {
    process.stdout.write(dflt === undefined ? ENGINE_USAGE : dflt.help(dflt.self()));
    return;
  }
  if (given > 1) return usageError("--platform given more than once; use one of: github, gitlab");
  if (given === 1 && (value === undefined || PROFILES[value] === undefined))
    return usageError(`--platform takes one of: github, gitlab (got ${value ?? "nothing"})`);
  const p = given === 1 ? PROFILES[value ?? ""] : dflt;
  if (p === undefined)
    return usageError("--platform <github|gitlab> is required; no platform is guessed");
  const args = given === 1 ? rest : argv;

  const self = p.self();
  const queue = ["", ""];
  const flush = (): void => {
    for (const fd of [0, 1] as const) {
      const text = queue[fd] ?? "";
      if (text !== "")
        (fd === 0 ? process.stdout : process.stderr).write(Buffer.from(text, "latin1"));
      queue[fd] = "";
    }
  };
  const put = (fd: 0 | 1) => (s: string) => {
    queue[fd] += s;
    if (!p.buffered) flush();
  };
  const [out, err] = [put(0), put(1)];

  // find -type f under a directory: lstat enumeration, symlinked files and directories skipped.
  const walk = (dir: string, acc: string[]): void => {
    let names: string[];
    try {
      names = fs.readdirSync(dir);
    } catch {
      return;
    }
    for (const n of names) {
      const q = dir.endsWith("/") ? dir + n : `${dir}/${n}`;
      const st = fs.lstatSync(q, { throwIfNoEntry: false });
      if (st === undefined) continue;
      if (st.isDirectory()) walk(q, acc);
      else if (st.isFile() && /\.ya?ml$/.test(n)) acc.push(q);
    }
  };

  let current = "";
  const run = (): number => {
    if (args.length !== 1) {
      err(`Usage: ${self} <${p.arg}>\n`);
      return 2;
    }
    const target = args[0] ?? "";
    const st = fs.statSync(target, { throwIfNoEntry: false });
    if (!st?.isDirectory() && !st?.isFile()) {
      err(`${RED}[FAIL] not a file or directory: ${u(target)}${RESET}\n`);
      return 1;
    }
    const files = st.isDirectory() ? p.discover(target, walk) : [target];
    if (files.length === 0) {
      out(`${p.empty}: ${u(target)}\n`);
      return 0;
    }
    let violations = 0;
    const report: Report = (file, lineno, pattern, risk) => {
      out(`${RED}[RISK]${RESET} ${u(file)}:${String(lineno)}: ${pattern}\n`);
      out(`       ${YELLOW}why:${RESET} ${u(risk)}\n`);
      violations += 1;
    };
    for (const f of files) {
      current = f;
      const rows = p.read(f).split("\n");
      if (rows[rows.length - 1] === "") rows.pop();
      p.scan(f, rows, report);
    }
    if (violations === 0) out(`${GREEN}[OK]${RESET} no secret-exposure patterns detected\n`);
    else err(`${RED}${String(violations)} risky pattern(s) found${RESET}\n`);
    return violations === 0 ? 0 : 1;
  };
  try {
    process.exitCode = run();
  } catch (e) {
    err(p.fail(e, current, self));
    process.exitCode = 1;
  }
  flush();
})();
