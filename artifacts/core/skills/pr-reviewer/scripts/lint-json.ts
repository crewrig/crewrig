// lint-json.ts — JSON linter for PR review (spec 0258 R11).
// Checks: valid JSON (JSON.parse), no trailing commas (line heuristic).
// Usage: node lint-json.ts <file1.json> [file2.json ...]
//        echo '{"a":1}' | node lint-json.ts   # reads stdin when no args given
// Exit 0 = no findings, 1 = findings.
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

  const args = process.argv.slice(2);
  const stdin = args.length === 0;
  const targets = stdin ? ["<stdin>"] : args;
  let findings = 0;

  for (const file of targets) {
    let data: Buffer;
    if (stdin) data = readStdin();
    else {
      let regular = false;
      try {
        regular = fs.statSync(file).isFile();
      } catch {
        regular = false;
      }
      if (!regular) {
        say(`${file}: not a regular file\n`);
        findings = 1;
        continue;
      }
      try {
        data = fs.readFileSync(file);
      } catch (err) {
        say(`${file}: invalid JSON — ${err instanceof Error ? err.message : String(err)}\n`);
        findings = 1;
        continue;
      }
    }

    const message = parseError(data);
    if (message !== undefined) {
      say(`${file}: invalid JSON — ${message}\n`);
      findings = 1;
    }

    // Trailing-comma heuristic, line by line: a comma, blanks, then `}` or a backslash and a
    // literal `]` (what the shell's `grep -nE ',\s*[}\]]'` really matched).
    const lines = data.toString("latin1").split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (/,[ \t\n\v\f\r]*[}\\]\]/.test(lines[i] as string)) {
        say(`${file}:${i + 1}: trailing comma before } or ]\n`);
        findings = 1;
      }
    }
  }

  process.exitCode = findings;
})();
