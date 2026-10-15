// Hook: shell-logger (spec 0179 R18 — maps-everywhere example)
//
// Fires before every shell-class tool call, on every supported target: the
// neutral `PreToolUse` event has a counterpart on Claude Code, Gemini CLI,
// GitHub Copilot CLI and the Antigravity CLI. Reads the tool-call payload on
// stdin and echoes it back unchanged, demonstrating a pass-through observer.
//
// ENTRY FORM (spec 0258 R2, R19, R20) — do not "tidy" it into an ordinary module:
//  - No top-level `import`/`export`: the file is a global script, so it loads
//    the same under every package type, and built-ins come from
//    `process.getBuiltinModule` (`require` does not exist next to this
//    extension's `"type": "module"` package.json).
//  - The first statement removes the `warning` listeners, so nothing reaches
//    standard error. The hook has no module graph, hence no `import()`.
//  - Failure silence: exit status 0 and nothing on standard error, whatever
//    happens to standard input.

process.removeAllListeners("warning");

void (async () => {
  try {
    const fs = process.getBuiltinModule("node:fs");
    // A closed pipe or a broken reader must stay silent: no error listener, no stderr.
    process.stdout.on("error", () => {});

    // `read -r PAYLOAD`: bytes up to the first line feed or to end of input. A
    // read that fails (closed input, EAGAIN on a non-blocking pipe, EOF on a
    // Windows console) keeps what was received. Never `readFileSync(0)`, which
    // throws on those inputs, and never a stream that waits for a writer that
    // does not close. Bytes, not text: nothing is decoded, so a multibyte
    // character split across two reads is written back whole.
    const chunk = Buffer.allocUnsafe(65536);
    const parts: Buffer[] = [];
    for (;;) {
      let count = 0;
      try {
        count = fs.readSync(0, chunk, 0, chunk.length, null);
      } catch {
        break;
      }
      if (count <= 0) break;
      const feed = chunk.subarray(0, count).indexOf(0x0a);
      parts.push(Buffer.from(chunk.subarray(0, feed < 0 ? count : feed)));
      if (feed >= 0) break;
    }
    const line = Buffer.concat(parts);

    // IFS blanks only (space and tab) at both ends; a carriage return stays.
    let start = 0;
    let end = line.length;
    while (start < end && (line[start] === 0x20 || line[start] === 0x09)) start += 1;
    while (end > start && (line[end - 1] === 0x20 || line[end - 1] === 0x09)) end -= 1;

    // `echo "$PAYLOAD"` writes the line and one line feed. A payload such as
    // `-n` is written literally, where the shell's `echo` took it as an option
    // (spec 0258 deviation (i)).
    process.stdout.write(Buffer.concat([line.subarray(start, end), Buffer.from("\n")]));
  } catch {
    // swallow every error: a hook never writes to standard error
  }
  process.exitCode = 0;
})();
