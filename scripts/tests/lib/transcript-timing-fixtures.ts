// transcript-timing-fixtures.ts — the inputs of the `windows-mempalace-transcript`
// timing steps (spec 0247 R19, plan step 22): the stdin payload file of each
// budgeted case, a daemon token file, a 50 MB transcript for the `Stop` case
// and a released loopback port for the nothing-listening case.
//
// Run as a script it writes them under a directory and appends `KEY=value`
// lines to $GITHUB_ENV, so the later steps of the job read them as environment
// variables:
//
//   node scripts/tests/lib/transcript-timing-fixtures.ts [<dir>]
//
//   TIMING_TOKEN_FILE          a daemon token file (MEMPALACE_DAEMON_TOKEN_FILE of every step)
//   TIMING_POSTTOOLUSE_PAYLOAD cases (a) and (b): a `PostToolUse` payload
//   TIMING_STOP_PAYLOAD        case (c): a `Stop` payload naming the 50 MB transcript
//   TIMING_PROMPT_PAYLOAD      case (d): a `UserPromptSubmit` payload
//   TIMING_CLOSED_PORT         case (d): a loopback port bound once, then released
//
// Every payload names the fixture directory as its `cwd`, so the hook takes the
// project from the payload and the timed runs spawn no Git process.
//
// Standard library only.

import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** The transcript size of R19(c). */
export const TRANSCRIPT_BYTES = 50 * 1024 * 1024;

export interface TranscriptTimingFixtures {
  readonly tokenFile: string;
  readonly transcript: string;
  readonly postToolUsePayload: string;
  readonly stopPayload: string;
  readonly promptPayload: string;
}

const SESSION = "timing-fixture-session";

function writePayload(file: string, payload: Record<string, unknown>): string {
  fs.writeFileSync(file, `${JSON.stringify(payload)}\n`);
  return file;
}

/** A JSON-lines transcript of at least `bytes` bytes whose last lines are responses. */
export function writeTranscript(file: string, bytes: number): void {
  const filler = "x".repeat(900);
  const line = (i: number): string =>
    `${JSON.stringify({ type: i % 2 === 0 ? "USER_INPUT" : "ASSISTANT_RESPONSE", content: `turn ${i} ${filler}` })}\n`;
  const fd = fs.openSync(file, "w");
  try {
    let written = 0;
    let i = 0;
    while (written < bytes) {
      const block: string[] = [];
      for (let n = 0; n < 1024; n += 1) block.push(line(i++));
      written += fs.writeSync(fd, block.join(""));
    }
    fs.writeSync(
      fd,
      `${JSON.stringify({ type: "ASSISTANT_RESPONSE", content: "timing transcript done" })}\n`,
    );
  } finally {
    fs.closeSync(fd);
  }
}

/** Write every fixture under `dir` (created when missing). */
export function writeTranscriptTimingFixtures(dir: string): TranscriptTimingFixtures {
  fs.mkdirSync(dir, { recursive: true });
  const base = fs.realpathSync.native(dir);
  const tokenFile = path.join(base, "token");
  fs.writeFileSync(tokenFile, "timing-fixture-token\n");
  const transcript = path.join(base, "transcript.jsonl");
  writeTranscript(transcript, TRANSCRIPT_BYTES);
  const common = { session_id: SESSION, cwd: base };
  return {
    tokenFile,
    transcript,
    postToolUsePayload: writePayload(path.join(base, "posttooluse.json"), {
      ...common,
      hook_event_name: "PostToolUse",
      tool_name: "Bash",
      tool_input: { command: "git status" },
    }),
    stopPayload: writePayload(path.join(base, "stop.json"), {
      ...common,
      hook_event_name: "Stop",
      transcript_path: transcript,
    }),
    promptPayload: writePayload(path.join(base, "prompt.json"), {
      ...common,
      hook_event_name: "UserPromptSubmit",
      prompt: "timing fixture prompt",
    }),
  };
}

/** A loopback port that was bound and released, so nothing listens on it. */
export function releasedPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as net.AddressInfo;
      server.close(() => resolve(port));
    });
  });
}

const invoked = process.argv[1];
if (invoked !== undefined && import.meta.url === pathToFileURL(fs.realpathSync(invoked)).href) {
  const dir = process.argv[2] ?? fs.mkdtempSync(path.join(os.tmpdir(), "transcript-timing-"));
  const fixtures = writeTranscriptTimingFixtures(dir);
  void releasedPort().then((port) => {
    const lines = [
      `TIMING_TOKEN_FILE=${fixtures.tokenFile}`,
      `TIMING_POSTTOOLUSE_PAYLOAD=${fixtures.postToolUsePayload}`,
      `TIMING_STOP_PAYLOAD=${fixtures.stopPayload}`,
      `TIMING_PROMPT_PAYLOAD=${fixtures.promptPayload}`,
      `TIMING_CLOSED_PORT=${port}`,
    ];
    const env = process.env["GITHUB_ENV"];
    if (env !== undefined && env !== "") fs.appendFileSync(env, `${lines.join("\n")}\n`);
    process.stdout.write(`${lines.join("\n")}\n`);
  });
}
