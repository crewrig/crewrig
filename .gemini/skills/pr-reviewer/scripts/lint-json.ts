// lint-json.ts — JSON linter for PR review.
// Checks: valid JSON (JSON.parse), no trailing commas (line heuristic).
// Usage: node lint-json.ts [--json] [--] [file1.json file2.json ...]
//        echo '{"a":1}' | node lint-json.ts   # reads stdin when no file is given
// Exit 0 = no finding, 1 = findings, 2 = usage error, 3 = an input is not a readable regular
// file (nothing is linted then). With --json it prints one {ok, data, findings} object on
// stdout and the human text on stderr.
// Self-contained on purpose: no import, built-ins through process.getBuiltinModule.

process.removeAllListeners("warning");

void (async () => {
  const fs = process.getBuiltinModule("node:fs");

  /** Bytes read as latin1 stay bytes: a file name or message goes out as its UTF-8 bytes. */
  const bin = (s: string): string => Buffer.from(s, "utf8").toString("latin1");
  const say = (s: string): void => {
    process.stdout.write(Buffer.from(bin(s), "latin1"));
  };

  function readStdin(): Buffer {
    const chunks: Buffer[] = [];
    const buf = Buffer.alloc(65536);
    for (;;) {
      let n = 0;
      try {
        n = fs.readSync(0, buf, 0, buf.length, null);
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "EAGAIN") {
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
          continue;
        }
        break;
      }
      if (n === 0) break;
      chunks.push(Buffer.from(buf.subarray(0, n)));
    }
    return Buffer.concat(chunks);
  }

  /** `JSON.parse` verdict: the V8 message on one line, or `undefined` when valid. */
  function parseError(data: Buffer): string | undefined {
    const start = data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf ? 3 : 0;
    try {
      JSON.parse(data.subarray(start).toString("utf8"));
      return undefined;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return message.replace(/[\r\n]+/g, " ");
    }
  }

  interface Finding {
    rule: string;
    message: string;
  }
  const USAGE =
    "Usage: node lint-json.ts [--json] [--] [file.json ...]\n" +
    "  Reads standard input when no file is given. Exit 0 clean, 1 findings, 2 usage error,\n" +
    "  3 an input is not a readable regular file.\n";
  const argv = process.argv.slice(2);
  let json = false;
  let help = false;
  let usageError: string | undefined;
  const args: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a === "--") {
      args.push(...argv.slice(i + 1));
      break;
    }
    if (a === "--json") json = true;
    else if (a === "--help" || a === "-h") help = true;
    else if (a.length > 1 && a.startsWith("-")) usageError ??= `unknown option ${a}`;
    else args.push(a);
  }
  const log = (s: string): void => {
    if (json) process.stderr.write(Buffer.from(bin(s), "latin1"));
    else say(s);
  };
  const finish = (code: number, data: object | null, findings: Finding[]): void => {
    if (json) process.stdout.write(`${JSON.stringify({ ok: code === 0, data, findings })}\n`);
    process.exitCode = code;
  };
  if (help) {
    process.stdout.write(USAGE);
    return;
  }
  if (usageError !== undefined) {
    log(`lint-json.ts: ${usageError}\n${USAGE}`);
    finish(2, null, [{ rule: "usage", message: usageError }]);
    return;
  }
  const stdin = args.length === 0;
  const targets = stdin ? ["<stdin>"] : args;
  // every input is checked before anything is linted: an unreadable one wins over a finding
  if (!stdin) {
    const unreadable = args.filter((f) => {
      try {
        return !fs.statSync(f).isFile();
      } catch {
        return true;
      }
    });
    if (unreadable.length > 0) {
      for (const f of unreadable) log(`${f}: not a readable regular file\n`);
      finish(
        3,
        null,
        unreadable.map((f) => ({
          rule: "precondition",
          message: `${f}: not a readable regular file`,
        })),
      );
      return;
    }
  }
  const found: Finding[] = [];
  const report = (rule: string, message: string): void => {
    log(`${message}\n`);
    found.push({ rule, message });
  };

  for (const file of targets) {
    let data: Buffer;
    if (stdin) data = readStdin();
    else {
      try {
        data = fs.readFileSync(file);
      } catch (err) {
        report(
          "invalid-json",
          `${file}: invalid JSON — ${err instanceof Error ? err.message : String(err)}`,
        );
        continue;
      }
    }

    const message = parseError(data);
    if (message !== undefined) report("invalid-json", `${file}: invalid JSON — ${message}`);

    // Trailing-comma heuristic, line by line: a comma, blanks, then `}` or a backslash and a
    // literal `]` (what the shell's `grep -nE ',\s*[}\]]'` really matched).
    const lines = data.toString("latin1").split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (/,[ \t\n\v\f\r]*[}\\]\]/.test(lines[i] as string))
        report("trailing-comma", `${file}:${i + 1}: trailing comma before } or ]`);
    }
  }

  finish(found.length > 0 ? 1 : 0, { files: targets }, found);
})();
