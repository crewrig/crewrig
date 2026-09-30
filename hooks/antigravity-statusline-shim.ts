// antigravity-statusline-shim.ts — the Antigravity CLI capture channel (spec
// 0243 R13, R14; behaviour of specs 0206 and 0241). Antigravity exposes no
// lifecycle hook for usage capture: the display command it already runs for
// a status line is the only trigger this channel has. The shim streams the
// payload to the user's prior status-line command (when one was configured)
// and forwards its output, then runs the capture step for the `antigravity`
// CLI in its own process.
//
// Usage: node hooks/antigravity-statusline-shim.ts   (payload on stdin)
//
// Exit status is ALWAYS 0 (R14), including when the capture graph is missing a
// dependency: a status line must never break on a capture failure. With no
// prior command nothing is written to standard output, never the raw payload
// (issue #1363, spec 0241). The prior command's own stderr passes through.
//
// The entry form is the one hooks/usage-capture.ts documents (R5): no module
// syntax, listeners removed first, all logic inside the async function.

process.removeAllListeners("warning");

void (async () => {
  const chunks: Buffer[] = [];
  try {
    for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  } catch {
    // closed or unreadable stdin: continue with what was read
  }
  const payload = Buffer.concat(chunks);

  try {
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    const { spawn } = require("node:child_process") as typeof import("node:child_process");
    const cursor =
      require("../scripts/lib/usage-capture/cursor.js") as typeof import("../scripts/lib/usage-capture/cursor.js");

    const marker = path.join(cursor.usageRoot(), "state", "antigravity-statusline.json");
    const state = JSON.parse(fs.readFileSync(marker, "utf8")) as unknown;
    const prior =
      typeof state === "object" && state !== null && !Array.isArray(state)
        ? (state as Record<string, unknown>)["priorStatusLineCommand"]
        : undefined;

    if (typeof prior === "string" && prior !== "") {
      // `shell: true` is /bin/sh on POSIX and %ComSpec% on Windows: the shim
      // names no interpreter of its own (R14).
      await new Promise<void>((resolve) => {
        const child = spawn(prior, { shell: true, stdio: ["pipe", "inherit", "inherit"] });
        child.stdin.on("error", () => undefined); // early close, EPIPE
        child.on("error", () => resolve());
        child.on("close", () => resolve());
        child.stdin.end(payload);
      });
    }
  } catch {
    // marker absent, unparsable or not an object: no prior command
  }

  try {
    const { runCapture } = await import("../scripts/lib/usage-capture/hook-run.ts");
    await runCapture({
      cli: "antigravity",
      event: "statusline",
      rawPayload: payload.toString("utf8"),
    });
  } catch {
    // exit-zero contract (R14), including a MissingDependencyError
  }
})();
