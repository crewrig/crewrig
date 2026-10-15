// check-pinned-actions.ts — flag GitHub Actions references that are not pinned to a 40-char
// commit SHA. TypeScript entry beside check-pinned-actions.sh (spec 0258); same output.
//
// Usage: node check-pinned-actions.ts <workflow-file-or-directory>
//
// Local actions (./path, ../path) and docker:// references are ignored. Limitation: only inline
// `uses: owner/repo@ref` values are matched; the dash form `- uses:` is not (as in the shell).
//
// Self-contained on purpose: the skill's scripts/ folder is copied out of the checkout, so this
// file imports nothing and loads Node built-ins with process.getBuiltinModule.
process.removeAllListeners("warning");

void (async () => {
  const fs = process.getBuiltinModule("node:fs");
  const tty = process.stdout.isTTY === true;
  const RED = tty ? "\u001b[0;31m" : "";
  const GREEN = tty ? "\u001b[0;32m" : "";
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

    const SP = "[ \\t\\n\\v\\f\\r]";
    const usesRe = new RegExp(`^${SP}*uses:${SP}*([^ \\t\\n\\v\\f\\r#]+)`);
    const shaRe = /@[0-9a-fA-F]{40}$/;
    let violations = 0;
    for (const f of files) {
      const rows = fs.readFileSync(f).toString("latin1").split("\n");
      if (rows[rows.length - 1] === "") rows.pop();
      rows.forEach((line, i) => {
        const m = usesRe.exec(line);
        if (m === null) return;
        let value = m[1] ?? "";
        if (value.endsWith('"')) value = value.slice(0, -1);
        if (value.startsWith('"')) value = value.slice(1);
        if (value.endsWith("'")) value = value.slice(0, -1);
        if (value.startsWith("'")) value = value.slice(1);
        if (value.startsWith("./") || value.startsWith("../") || value.startsWith("docker://"))
          return;
        if (!value.includes("@") || !shaRe.test(value)) {
          out(`${RED}[UNPINNED]${RESET} ${u(f)}:${i + 1}: ${value}\n`);
          violations += 1;
        }
      });
    }

    if (violations === 0) {
      out(`${GREEN}[OK]${RESET} all action references are pinned to a SHA\n`);
      return;
    }
    err(`${RED}${violations} unpinned action reference(s) found${RESET}\n`);
    process.exitCode = 1;
  } catch (e) {
    err(`${self}: ${e instanceof Error ? u(e.message) : String(e)}\n`);
    process.exitCode = 1;
  }
})();
