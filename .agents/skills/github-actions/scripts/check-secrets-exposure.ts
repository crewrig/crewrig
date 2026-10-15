// check-secrets-exposure.ts — flag patterns in GitHub Actions workflows that may leak secrets
// into logs or widen the secret blast radius. TypeScript entry beside check-secrets-exposure.sh
// (spec 0258); same output.
//
// Usage: node check-secrets-exposure.ts <workflow-file-or-directory>
//
// Patterns flagged:
//   1. `echo ${{ secrets.* }}`                          (secret echoed to stdout)
//   2. workflow-level `env:` referencing `secrets.*`    (broad blast radius across all jobs)
//   3. `set -x` / `set +x`                              (shell trace expands env values)
//   4. `toJSON(secrets)`                                (serializes every secret as JSON)
//
// Self-contained on purpose: the skill's scripts/ folder is copied out of the checkout, so this
// file imports nothing and loads Node built-ins with process.getBuiltinModule.
process.removeAllListeners("warning");

void (async () => {
  const fs = process.getBuiltinModule("node:fs");
  const tty = process.stdout.isTTY === true;
  const RED = tty ? "\u001b[0;31m" : "";
  const GREEN = tty ? "\u001b[0;32m" : "";
  const YELLOW = tty ? "\u001b[0;33m" : "";
  const RESET = tty ? "\u001b[0m" : "";
  /** Bytes of a UTF-8 string, held as a latin1 string (the files are read as latin1). */
  const u = (s: string): string => Buffer.from(s, "utf8").toString("latin1");
  const out = (s: string): void => {
    process.stdout.write(Buffer.from(s, "latin1"));
  };
  const err = (s: string): void => {
    process.stderr.write(Buffer.from(s, "latin1"));
  };
  const self = u((process.argv[1] ?? "").split(/[\\/]/).pop() ?? "");
  const stat = (p: string): import("node:fs").Stats | undefined => {
    try {
      return fs.statSync(p);
    } catch {
      return undefined;
    }
  };

  try {
    const args = process.argv.slice(2);
    if (args.length !== 1) {
      err(`Usage: ${self} <workflow-file-or-directory>\n`);
      process.exitCode = 2;
      return;
    }
    const target = args[0] ?? "";

    const files: string[] = [];
    if (stat(target)?.isDirectory() === true) {
      const walk = (dir: string): void => {
        let names: string[];
        try {
          names = fs.readdirSync(dir);
        } catch {
          return;
        }
        for (const n of names) {
          const p = dir.endsWith("/") ? dir + n : `${dir}/${n}`;
          let st: import("node:fs").Stats;
          try {
            st = fs.lstatSync(p);
          } catch {
            continue;
          }
          if (st.isDirectory()) walk(p);
          else if (st.isFile() && /\.ya?ml$/.test(n)) files.push(p);
        }
      };
      let start = `${target}/.github/workflows`;
      if (stat(start)?.isDirectory() !== true) start = target;
      if (fs.lstatSync(start).isDirectory()) walk(start);
      files.sort((a, b) => Buffer.compare(Buffer.from(a, "utf8"), Buffer.from(b, "utf8")));
    } else if (stat(target)?.isFile() === true) {
      files.push(target);
    } else {
      err(`${RED}[FAIL] not a file or directory: ${u(target)}${RESET}\n`);
      process.exitCode = 1;
      return;
    }

    if (files.length === 0) {
      out(`no workflow files found under: ${u(target)}\n`);
      return;
    }

    let violations = 0;
    const report = (file: string, line: number, pattern: string, risk: string): void => {
      out(`${RED}[RISK]${RESET} ${u(file)}:${line}: ${pattern}\n`);
      out(`       ${YELLOW}why:${RESET} ${u(risk)}\n`);
      violations += 1;
    };

    const SP = "[ \\t\\n\\v\\f\\r]";
    const echoRe = new RegExp(`echo${SP}[^]*\\$\\{\\{${SP}*secrets\\.`);
    const envRe = new RegExp(`^env:${SP}*$`);
    const nonIndentRe = new RegExp(`^[^ \\t\\n\\v\\f\\r#]`);
    const secretRe = new RegExp(`\\$\\{\\{${SP}*secrets\\.`);
    const setRe = new RegExp(`(^|[^A-Za-z0-9_])set${SP}+[-+]x(${SP}|$)`);
    const jsonRe = new RegExp(`toJSON\\(${SP}*secrets${SP}*\\)`);

    for (const f of files) {
      const rows = fs.readFileSync(f).toString("latin1").split("\n");
      if (rows[rows.length - 1] === "") rows.pop();
      let inEnv = false;
      let envLine = 0;
      let sawEnv = false;
      rows.forEach((line, i) => {
        const lineno = i + 1;
        if (echoRe.test(line))
          report(
            f,
            lineno,
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
            report(
              f,
              envLine,
              "top-level env: references ${{ secrets.* }}",
              "secrets defined at workflow level are inherited by every job (broad blast radius)",
            );
            inEnv = false;
          }
        }

        if (setRe.test(line))
          report(
            f,
            lineno,
            "set -x / set +x",
            "shell xtrace prints every expanded command, including secret env values",
          );

        if (jsonRe.test(line))
          report(
            f,
            lineno,
            "toJSON(secrets)",
            "serializes the entire secrets context — any later echo, env, or file write leaks them all",
          );
      });
    }

    if (violations === 0) {
      out(`${GREEN}[OK]${RESET} no secret-exposure patterns detected\n`);
      return;
    }
    err(`${RED}${violations} risky pattern(s) found${RESET}\n`);
    process.exitCode = 1;
  } catch (e) {
    err(`${self}: ${e instanceof Error ? u(e.message) : String(e)}\n`);
    process.exitCode = 1;
  }
})();
