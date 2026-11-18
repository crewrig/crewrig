// framework-release-stub.ts — a localhost stand-in for the slice of the GitHub REST API the framework
// publisher calls (spec 0310 R12). It records every request; no network beyond 127.0.0.1 is used.

import http from "node:http";
import type { AddressInfo } from "node:net";

export interface Req {
  readonly method: string;
  readonly path: string;
  readonly body: Buffer;
}

export interface StubOptions {
  readonly releases?: ReadonlyArray<Record<string, unknown>>;
  /** Digest GitHub reports on the upload response; `null` or `""` for none. */
  readonly uploadDigest?: string | null;
  /** Digest on the release read-back (`GET /releases/<id>`); `null` for none. */
  readonly readbackDigest?: string | null;
}

export class Stub {
  readonly requests: Req[] = [];
  private server = http.createServer();
  url = "";

  private readonly opts: StubOptions;

  constructor(opts: StubOptions = {}) {
    this.opts = opts;
  }

  async start(): Promise<void> {
    this.server.on("request", (req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => {
        const entry = { method: req.method ?? "", path: req.url ?? "", body: Buffer.concat(chunks) };
        this.requests.push(entry);
        const [status, payload] = this.answer(entry);
        res.writeHead(status, { "content-type": "application/json" });
        res.end(payload === undefined ? "" : JSON.stringify(payload));
      });
    });
    await new Promise<void>((resolve) => this.server.listen(0, "127.0.0.1", resolve));
    this.url = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  stop(): Promise<void> {
    this.server.closeAllConnections();
    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  private asset(digest: string | null | undefined): Record<string, unknown> {
    return { name: "a.tgz", ...(digest === undefined || digest === null || digest === "" ? {} : { digest }) };
  }

  private answer(req: Req): [number, unknown] {
    const p = req.path.split("?")[0] ?? "";
    if (req.method === "GET" && p.endsWith("/releases")) {
      return [200, req.path.includes("page=1") ? (this.opts.releases ?? []) : []];
    }
    if (req.method === "DELETE") return [204, undefined];
    if (req.method === "POST" && p.endsWith("/releases")) return [201, { id: 900, tag_name: "t", draft: true }];
    if (req.method === "POST" && p.endsWith("/assets")) return [201, this.asset(this.opts.uploadDigest)];
    if (req.method === "GET" && /\/releases\/\d+$/.test(p)) {
      return [200, { id: 900, assets: [this.asset(this.opts.readbackDigest)] }];
    }
    if (req.method === "PATCH") return [200, { id: 900 }];
    return [404, { message: "not found" }];
  }

  calls(): string[] {
    return this.requests.map((r) => `${r.method} ${r.path.split("?")[0]}`);
  }
}
