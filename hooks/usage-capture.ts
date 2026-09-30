// usage-capture.ts — the usage-capture hook Claude Code, Gemini CLI and
// Copilot CLI fire at the end of a turn or a session (spec 0243 R1-R12). It
// replaces the shell wrapper of the same name, which stays as a forwarding
// shim for installations still wired to the `.sh` path (R2).
//
// Usage: node hooks/usage-capture.ts <cli> <event>   (payload on stdin)
//   <cli>   claude-code | gemini-cli | copilot-cli
//   <event> the firing lifecycle event name, forwarded verbatim
//
// ENTRY FORM (R5) — do not "tidy" it into an ordinary module:
//  - No top-level `import`/`export` and nothing declared at global scope, so
//    Node.js loads the file as CommonJS and prints no
//    MODULE_TYPELESS_PACKAGE_JSON warning for it. `node:` built-ins come from
//    `require()` (cast, so the typed lint rules hold); the rest from `import()`.
//  - The first statement removes the `warning` listeners, which silences the
//    entry's own deferred warning (Node.js 24.0.0's type-stripping
//    ExperimentalWarning) and that of every module loaded lazily below.
//  - No `uncaughtException` handler: it would blind the deprecation channel
//    (`--throw-deprecation` in CI), which reports outside this try/catch.
//
// Exit status is 0 and both streams stay empty on every failure. The one
// exception is a `MissingDependencyError` (R12): one line on standard error
// and status 1, never 2, which some of the four CLIs read as "block".
//
// Guard (R6, R8): read all of standard input first (R4), decide with the
// standard library and the stdlib-only cursor.js whether there is anything to
// capture, and load the capture graph only when there is.

process.removeAllListeners("warning");

void (async () => {
  try {
    const fs = require("node:fs") as typeof import("node:fs");
    const os = require("node:os") as typeof import("node:os");
    const path = require("node:path") as typeof import("node:path");
    const cursor =
      require("../scripts/lib/usage-capture/cursor.js") as typeof import("../scripts/lib/usage-capture/cursor.js");

    const cli = process.argv[2] ?? "";
    const event = process.argv[3] ?? "";

    // Stream read (`readFileSync(0)` throws EAGAIN on a non-blocking pipe and
    // EOF on a closed or console stdin on Windows). A failed read keeps what
    // was received: an empty payload still reaches capture, as `$(cat)` did.
    const chunks: Buffer[] = [];
    try {
      for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
    } catch {
      // closed or unreadable stdin: fall through with what was read
    }
    const rawPayload = Buffer.concat(chunks).toString("utf8");

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawPayload);
    } catch {
      parsed = undefined;
    }

    // The source the capture step keys its stamp on: the fixed store for
    // Copilot CLI, else the parsed payload's top-level `transcript_path`,
    // falling back to `transcriptPath` when falsy (index.js's own selection).
    let source: unknown;
    if (cli === "copilot-cli") {
      source = path.join(os.homedir(), ".copilot", "session-store.db");
    } else if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      const fields = parsed as Record<string, unknown>;
      source = fields["transcript_path"] || fields["transcriptPath"];
    }

    if (typeof source === "string" && path.isAbsolute(source)) {
      try {
        const sourceStat = fs.statSync(source);
        const stampStat = fs.statSync(cursor.stampPath(cli, source));
        if (sourceStat.isFile() && stampStat.isFile() && sourceStat.mtimeMs <= stampStat.mtimeMs) {
          return; // nothing new: the capture graph is never loaded
        }
      } catch {
        // missing source or stamp: a wrong guess costs one capture, never a record
      }
    }

    const { runCapture } = await import("../scripts/lib/usage-capture/hook-run.ts");
    await runCapture({ cli, event, rawPayload });
  } catch (error) {
    if (error instanceof Error && error.name === "MissingDependencyError") {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    }
  }
})();
