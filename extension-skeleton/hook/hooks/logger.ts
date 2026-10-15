// Hook: ${SKELETON_NAME} logger
// Intercepts tool calls. Modify or validate the payload as needed.
//
// ENTRY FORM (spec 0258 R2, R19, R20) — keep it when you edit this file:
//  - No top-level `import`/`export`, so the file loads the same under every
//    package type; built-ins come from `process.getBuiltinModule`.
//  - The first statement removes the `warning` listeners; the body sits in the
//    async wrapper; set `process.exitCode`, never call `process.exit`.
//  - A hook never writes to standard error and exits 0 on a read error.
//
// WHEN THIS HOOK GROWS A MODULE GRAPH: keep the cheap decision here and load the
// graph only on the path that needs it, so the common case stays fast:
//
//   const payload = line.subarray(start, end).toString("utf8");
//   if (!payload.includes("watched-word")) return;          // cheap guard, built-ins only
//   const { inspect } = await import("./lib/inspect.ts");     // lazy import(), slow path only
//   process.stdout.write(inspect(payload));
//
// A module loaded this way is an ES module under a `"type": "module"` package
// and a CommonJS module otherwise; keep it free of top-level side effects.

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
