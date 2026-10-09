// probe.ts — the bounded HTTP probe (spec 0252 requirements 11(f), 15 and 27;
// plan v2 D3).
//
// One request, one timer from connect to the last byte, a bounded body. No
// spawn, no JSON-RPC, no `add_drawer`, and nothing from mempalace-transcript/.
// An `authorization` header is accepted only when the target host passes the
// loopback rule `isLoopbackHost` (the rule of scripts/status-mcp-server.sh
// `_status_loopback_host`, ported in mempalace-registration.ts and reused
// here); otherwise nothing is sent. The bounds (3 s for `/healthz`, 2 s for the
// ChromaDB heartbeat) are the caller's `timeoutMs`. Redirects are not followed.
// Errors carry a reason only, never a header value.

import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isLoopbackHost } from "../mempalace-registration.ts";

export { isLoopbackHost };

export interface ProbeRequest {
  readonly url: string;
  readonly method?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
  /** Whole-exchange bound, from connect to the last byte, in milliseconds. */
  readonly timeoutMs: number;
  /** Cap on the response body, in bytes. Default 65 536. */
  readonly maxBodyBytes?: number;
}

export type ProbeResult =
  | { readonly status: number; readonly body: string }
  | { readonly error: string };

export const DEFAULT_MAX_BODY_BYTES = 64 * 1024;

function hasAuthorization(headers: Readonly<Record<string, string>>): boolean {
  return Object.keys(headers).some((name) => name.toLowerCase() === "authorization");
}

/** Probe `url` once. Never throws; always resolves. */
export function probe(req: ProbeRequest): Promise<ProbeResult> {
  return new Promise<ProbeResult>((resolve) => {
    if (!Number.isFinite(req.timeoutMs) || req.timeoutMs <= 0) {
      resolve({ error: "invalid timeout" });
      return;
    }
    let target: URL;
    try {
      target = new URL(req.url);
    } catch {
      resolve({ error: "invalid url" });
      return;
    }
    if (target.protocol !== "http:" && target.protocol !== "https:") {
      resolve({ error: "unsupported protocol" });
      return;
    }
    const headers = req.headers ?? {};
    if (hasAuthorization(headers) && !isLoopbackHost(target.hostname)) {
      resolve({ error: "refused: authorization header to a non-loopback host" });
      return;
    }
    const maxBody = req.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
    const send = target.protocol === "https:" ? httpsRequest : httpRequest;
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const finish = (result: ProbeResult, abort?: () => void): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      abort?.();
      resolve(result);
    };
    const outgoing = send(
      target,
      {
        method: req.method ?? "GET",
        headers: {
          ...headers,
          connection: "close",
          ...(req.body === undefined
            ? {}
            : { "content-length": String(Buffer.byteLength(req.body)) }),
        },
        agent: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBody) {
            finish({ error: `body exceeds ${maxBody} bytes` }, () => outgoing.destroy());
            return;
          }
          chunks.push(chunk);
        });
        res.on("end", () =>
          finish({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }),
        );
        res.on("error", () => finish({ error: "response error" }));
        res.on("aborted", () => finish({ error: "response aborted" }));
      },
    );
    timer = setTimeout(
      () => finish({ error: `timeout after ${req.timeoutMs} ms` }, () => outgoing.destroy()),
      req.timeoutMs,
    );
    outgoing.on("error", (err: NodeJS.ErrnoException) =>
      finish({ error: `request failed: ${err.code ?? "error"}` }),
    );
    outgoing.end(req.body);
  });
}
