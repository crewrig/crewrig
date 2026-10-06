// mempalace-transcript.ts — the session-recording hook Claude Code, Gemini
// CLI, Copilot CLI and Antigravity CLI fire to persist session exchanges to
// MemPalace's `transcripts` wing (spec 0247 R1-R18). It replaces the shell
// hook of the same name, which stays as a forwarding shim for installations
// still wired to the `.sh` path (R2).
//
// Usage (payload on stdin, R3):
//   node hooks/mempalace-transcript.ts                     legacy form, gated on
//                                                          MEMPALACE_TRANSCRIPT_ENABLED=1
//   node hooks/mempalace-transcript.ts <event>             legacy Antigravity form, same gate
//   node hooks/mempalace-transcript.ts claude-code|gemini-cli|copilot-cli
//   node hooks/mempalace-transcript.ts antigravity-cli <event>
// The direct forms (CLI identifier) record unless MEMPALACE_TRANSCRIPT_ENABLED
// is set to a non-empty value other than `1`, the kill-switch (R4).
//
// ENTRY FORM (R1) — do not "tidy" it into an ordinary module:
//  - No top-level `import`/`export` and nothing declared at global scope, so
//    Node.js loads the file as CommonJS and prints no
//    MODULE_TYPELESS_PACKAGE_JSON warning for it. It needs no `node:` built-in.
//  - The first statement removes the `warning` listeners, which silences the
//    entry's own deferred warning (Node.js 24.0.0's type-stripping
//    ExperimentalWarning) and that of every module loaded lazily below.
//  - No `uncaughtException` handler: it would blind the deprecation channel
//    (`--throw-deprecation` in CI), which reports outside this try/catch.
//
// Streams and status (R5, R6, R18): in Antigravity mode exactly `{}` and a line
// feed on standard output on every path, written from `finally`; nothing on
// standard output otherwise. Exit status 0 on every path but a
// `MissingDependencyError`: one line on standard error and status 1, never 2.
//
// Guard (R7): the shape, the enablement, the payload and the `PostToolUse`
// exit are decided here with the standard library alone; the module graph that
// builds and sends a record is loaded only past that point.

process.removeAllListeners("warning");

void (async () => {
  const args = process.argv.slice(2);
  const first = args[0] ?? "";
  const directIds = ["claude-code", "gemini-cli", "copilot-cli"];
  let antigravity = false;
  try {
    // --- Argument shape (R3) ---
    let direct = false;
    let antigravityEvent = "";
    if (first === "") {
      // (a) no argument, or an empty first one: the legacy form
    } else if (directIds.includes(first) || first === "antigravity-cli") {
      const arity = first === "antigravity-cli" ? 2 : 1;
      if (args.length !== arity) {
        antigravity = first === "antigravity-cli";
        process.stderr.write(
          "mempalace-transcript: expected no argument, <event>, claude-code, gemini-cli, copilot-cli or antigravity-cli <event>\n",
        );
        return;
      }
      direct = true;
      if (first === "antigravity-cli") {
        antigravity = true;
        antigravityEvent = args[1] ?? "";
      }
    } else {
      // (b) the legacy Antigravity form: the argument is the event name
      antigravity = true;
      antigravityEvent = first;
    }

    // --- Enablement (R4) ---
    const enabled = process.env["MEMPALACE_TRANSCRIPT_ENABLED"] ?? "";
    if (direct ? enabled !== "" && enabled !== "1" : enabled !== "1") return;

    // --- Payload (R7) ---
    // Stream read (`readFileSync(0)` throws EAGAIN on a non-blocking pipe and
    // EOF on a closed or console stdin on Windows). An interactive terminal is
    // never read.
    const chunks: Buffer[] = [];
    if (!process.stdin.isTTY) {
      try {
        for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
      } catch {
        // closed or unreadable stdin: fall through with what was read
      }
    }
    let payload: unknown;
    try {
      payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      return;
    }
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return;

    // The event (R10): `hook_event_name`, else the Antigravity event argument.
    // `jq -r` rendered a number in decimal; any other non-string is absent.
    const named = (payload as Record<string, unknown>)["hook_event_name"];
    let event = "";
    if (typeof named === "string") event = named.replace(/\n+$/, "");
    else if (typeof named === "number" && Number.isFinite(named)) event = JSON.stringify(named);
    if (event === "") event = antigravityEvent;
    if (event === "PostToolUse") return;

    const { runTranscript } = await import("../scripts/lib/mempalace-transcript/run.ts");
    await runTranscript({
      payload: payload as Readonly<Record<string, unknown>>,
      antigravityEvent,
      antigravity,
      event,
    });
  } catch (error) {
    if (error instanceof Error && error.name === "MissingDependencyError") {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    }
  } finally {
    if (antigravity) {
      // A CLI that closed its end first must not turn the write into an
      // unhandled EPIPE and a non-zero exit (R6; security review S5).
      process.stdout.on("error", () => {});
      process.stdout.write("{}\n");
    }
  }
})();
