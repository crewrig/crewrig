// tls-delegation.ts — the node entry of the function shims of scripts/lib/tls-delegation.sh
// (spec 0256 requirement 33, as modified by delta-01).
//
// Usage: node scripts/tls-delegation.ts detect
//        node scripts/tls-delegation.ts candidate
//        node scripts/tls-delegation.ts offer [--result <file>] [--answer tls-delegation=<yes|no>] [--forwarded]
// Run `node scripts/lib/node-floor-guard.js` first on an unverified Node.js: the tool needs
// Node.js 24 or later. `detect` and `candidate` print nothing but the bundle path, `offer` prints
// exactly what `offer_tls_delegation` printed (the shim sources the written file itself).
// Status: 0 done (`detect`: detected), 1 nothing (`detect`: not detected, `candidate`: none; `offer`:
// invalid TLS_DELEGATION), 2 usage error. `--result` writes one line `wrote=1` or `wrote=0`.
// `--forwarded` (needs `--answer`) marks a run whose caller, the function shim, already printed the
// preamble and asked the question itself: the entry then prints neither the preamble nor the
// `[answer] tls-delegation=<choice>` echo, so the shim's standard output is the shell's, byte for byte.
//
// ENTRY FORM (spec 0255 R3; spec 0250 R3) — do not "tidy" it into an ordinary module:
//  - No top-level `import`/`export` and nothing declared at global scope, so Node.js loads the
//    file as CommonJS and prints no MODULE_TYPELESS_PACKAGE_JSON warning for it; the module
//    graph comes from `import()`, one subcommand at a time so `detect` stays cheap.
//  - The first statement removes the `warning` listeners.
//  - No `uncaughtException` handler: it would blind the deprecation channel.
//  - `process.exitCode`, never `process.exit`: standard output drains first.

process.removeAllListeners("warning");

void (async () => {
  try {
    const { escapeControl } = await import("./lib/escape-control.ts");
    const usage = (message: string): void => {
      process.stderr.write(`Error: ${escapeControl(message)}\n`);
      process.exitCode = 2;
    };
    const shape =
      "usage: tls-delegation.ts detect | candidate | offer [--result <file>] [--answer tls-delegation=<yes|no>] [--forwarded]";
    const [command, ...rest] = process.argv.slice(2);
    if (command === "detect" || command === "candidate") {
      if (rest.length > 0) return usage(`${command} takes no argument; ${shape}`);
      const tls = await import("./lib/setup/tls-detect.ts");
      if (command === "detect") {
        process.exitCode = tls.detectCustomTlsContext(process.env, tls.defaultTlsFs.readdir)
          ? 0
          : 1;
        return;
      }
      const found = tls.candidateCa(process.env, tls.defaultTlsFs.isFile);
      if (found !== undefined) process.stdout.write(`${found}\n`);
      process.exitCode = found === undefined ? 1 : 0;
      return;
    }
    if (command !== "offer") return usage(shape);

    let result: string | undefined;
    const answerTokens: string[] = [];
    let forwarded = false;
    for (let i = 0; i < rest.length; i += 1) {
      const arg = rest[i] ?? "";
      if (arg === "--forwarded") {
        forwarded = true;
        continue;
      }
      const eq = arg.indexOf("=");
      const name = arg.startsWith("--") && eq > 0 ? arg.slice(0, eq) : arg;
      const inline = name === arg ? undefined : arg.slice(eq + 1);
      if (name !== "--result" && name !== "--answer") return usage(`unknown argument '${arg}'`);
      const value = inline ?? rest[(i += 1)];
      if (value === undefined || value === "") return usage(`${name} expects a value`);
      if (name === "--answer") answerTokens.push("--answer", value);
      else if (result !== undefined) return usage("--result given twice");
      else result = value;
    }

    if (forwarded && answerTokens.length === 0) return usage("--forwarded needs --answer");

    const { parseSetupArgv } = await import("./lib/setup/argv.ts");
    const { createAnswers } = await import("./lib/setup/answers.ts");
    const { answerEcho, createSession } = await import("./lib/setup/prompt.ts");
    const { createLineQueue } = await import("./lib/setup/prompt-queue.ts");
    const { offerTlsDelegation, TLS_QUESTION_ID } = await import("./lib/setup/tls-offer.ts");
    const { SetupExit } = await import("./lib/setup/exit.ts");
    const fs = await import("node:fs");
    const os = await import("node:os");
    const io = {
      out: (line: string) => void process.stdout.write(`${line}\n`),
      err: (line: string) => void process.stderr.write(`${line}\n`),
      errRaw: (text: string) => void process.stderr.write(text),
    };
    const win = process.platform === "win32";
    const home = [win ? "USERPROFILE" : "HOME", win ? "HOME" : "USERPROFILE"]
      .map((key) => process.env[key])
      .find((value) => typeof value === "string" && value !== "");
    // Standard input is read only when a question is asked: an unread, flowing stream would keep the
    // process alive until the caller's terminal or pipe closes.
    let queue: ReturnType<typeof createLineQueue> | undefined;
    const lazy = {
      next: () => (queue ??= createLineQueue(process.stdin)).next(),
      close: () => queue?.close(),
    };
    let wrote = 0;
    try {
      const parsed = parseSetupArgv(answerTokens, io);
      const answers = createAnswers(parsed, "claude", io);
      const other = parsed.answers.find((answer) => answer.id !== TLS_QUESTION_ID);
      if (other !== undefined) return usage(`--answer: this entry only asks '${TLS_QUESTION_ID}'`);
      // A forwarded run drops the prompter's echo of the answer: the original never printed it.
      const echoPrefix = answerEcho(TLS_QUESTION_ID, "");
      const quiet = {
        ...io,
        out: (line: string) => {
          if (!(forwarded && line.startsWith(echoPrefix))) io.out(line);
        },
      };
      const session = createSession({
        queue: lazy,
        answers,
        io: quiet,
        isTty: process.stdin.isTTY === true,
      });
      const ctx = { io, env: process.env, home: home ?? os.homedir() };
      const offered = await offerTlsDelegation({ ctx, session, forwarded });
      wrote = offered.wrote ? 1 : 0;
    } catch (error) {
      if (!(error instanceof SetupExit)) throw error;
      process.exitCode = error.status;
    } finally {
      lazy.close();
      if (queue !== undefined) process.stdin.pause();
    }
    if (result !== undefined) fs.writeFileSync(result, `wrote=${wrote}\n`);
  } catch (error) {
    // A path inside the message may hold a control character: show it as `\xNN`.
    const text = error instanceof Error ? error.message : String(error);
    const show = await import("./lib/escape-control.ts").then(
      (m) => m.escapeControl,
      () => (raw: string) => raw,
    );
    process.stderr.write(`Error: ${show(text)}\n`);
    process.exitCode = 1;
  }
})();
