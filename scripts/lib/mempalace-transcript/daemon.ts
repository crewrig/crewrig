// daemon.ts — the one request the MemPalace transcript hook sends to the
// shared MemPalace MCP HTTP daemon (spec 0247 R13, R15; ADR-0016).
//
// One JSON-RPC 2.0 `tools/call` of `mempalace_add_drawer`, as an HTTP POST to
// `http://<host>:<port>/mcp` with a bearer `Authorization` header. One 5-second
// timer bounds the whole exchange, connection to last body byte (issue #90).
// Host and port come from `endpoint()` of scripts/lib/usage-store/mcp.js, the
// framework's one definition of them (decision Q3); that module's `call()` is
// not used — its bound and failure classes differ. No process is spawned, so
// neither the token nor the content is ever on an argument list.
//
// Outcome, with the shell's status codes (hooks/mempalace-transcript.sh:242-359):
//   ok   a 2xx answer whose body is JSON, with no `error.message` and no
//        `result.isError` equal to `true`;
//   3    `ADD_FAILED: <message>` — a JSON-RPC error, or `result.isError`;
//   4    `DAEMON_UNREACHABLE: <host>:<port> — <reason>` — a connection
//        failure, the 5-second bound, a non-2xx status or a body that is not
//        JSON (the last two are a deviation of R30: the shell counted them as
//        persisted).
//
// Standard library only.

import http from "node:http";

import { endpoint } from "../usage-store/mcp.js";
import { renderSelected, valueAt } from "./fields.ts";

export const DAEMON_TIMEOUT_MS = 5000;
// A daemon answer to one add_drawer call is a few hundred bytes; a body past
// this bound is not read further and counts as unreachable.
const MAX_BODY_BYTES = 1024 * 1024;

export type DaemonOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly status: 3 | 4; readonly diagnostic: string };

export interface DrawerRequest {
  readonly room: string;
  readonly content: string;
  readonly token: string;
}

/** The JSON-RPC request body of `:286-303`. */
export function requestBody(room: string, content: string): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: {
      name: "mempalace_add_drawer",
      arguments: { wing: "transcripts", room, content, added_by: "transcript-hook" },
    },
  });
}

/** Classify a received answer (status code and body). */
export function classifyAnswer(where: string, statusCode: number, body: string): DaemonOutcome {
  if (statusCode < 200 || statusCode > 299) {
    return {
      ok: false,
      status: 4,
      diagnostic: `DAEMON_UNREACHABLE: ${where} — HTTP ${statusCode}`,
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return {
      ok: false,
      status: 4,
      diagnostic: `DAEMON_UNREACHABLE: ${where} — response is not JSON`,
    };
  }
  const message = renderSelected(valueAt(parsed, ["error", "message"]));
  if (message !== undefined) return { ok: false, status: 3, diagnostic: `ADD_FAILED: ${message}` };
  if (valueAt(parsed, ["result", "isError"]) === true) {
    const text = renderSelected(valueAt(parsed, ["result", "content", 0, "text"])) ?? "";
    return { ok: false, status: 3, diagnostic: `ADD_FAILED: ${text}` };
  }
  return { ok: true };
}

/** Send the drawer and classify the outcome. Never rejects. */
export function addDrawer(request: DrawerRequest): Promise<DaemonOutcome> {
  const { host, port } = endpoint();
  const where = `${host}:${port}`;
  const unreachable = (reason: string): DaemonOutcome => ({
    ok: false,
    status: 4,
    diagnostic: `DAEMON_UNREACHABLE: ${where} — ${reason}`,
  });
  const body = requestBody(request.room, request.content);

  return new Promise<DaemonOutcome>((resolve) => {
    let settled = false;
    let req: http.ClientRequest | undefined;
    let timer: NodeJS.Timeout | undefined;
    const finish = (outcome: DaemonOutcome): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      req?.destroy();
      resolve(outcome);
    };
    timer = setTimeout(() => {
      finish(unreachable(`no answer within ${DAEMON_TIMEOUT_MS / 1000} s`));
    }, DAEMON_TIMEOUT_MS);

    try {
      req = http.request(
        {
          host,
          port,
          path: "/mcp",
          method: "POST",
          agent: false,
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(body),
            Authorization: `Bearer ${request.token}`,
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          let size = 0;
          res.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
              finish(unreachable(`response larger than ${MAX_BODY_BYTES} bytes`));
              return;
            }
            chunks.push(chunk);
          });
          res.on("end", () => {
            finish(
              classifyAnswer(where, res.statusCode ?? 0, Buffer.concat(chunks).toString("utf8")),
            );
          });
          res.on("error", (error: Error) => finish(unreachable(error.message)));
        },
      );
      req.on("error", (error: NodeJS.ErrnoException) => {
        finish(unreachable(error.code ?? error.message));
      });
      req.end(body);
    } catch (error) {
      // An endpoint that cannot be dialled, such as a malformed port.
      finish(unreachable(error instanceof Error ? error.message : String(error)));
    }
  });
}
