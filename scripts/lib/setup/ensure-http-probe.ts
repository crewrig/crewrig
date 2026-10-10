// ensure-http-probe.ts — the types and the production seams of `ensureMempalaceHttp`
// (scripts/lib/setup/ensure-http.ts; spec 0256 requirement 26, deviation (o) of delta-01). Every
// seam of the flow is a member of `EnsureHttpDeps`, so the flow's tests run with fakes and no
// process, no daemon and no home; this file wires each seam to the shipped service modules:
//
//   readToken     readOrCreateToken            (scripts/lib/service/token.ts; throws TokenError)
//   probeAccepts  probeAccepts                 (scripts/lib/service/daemon-replace.ts): an
//                 authenticated `tools/list` POST sent by a Node request, the bearer in a header
//                 and never on an argument list, and never to a non-loopback host (probe.ts:59)
//   installDaemon installMcpDaemon             (scripts/lib/service/daemon-install.ts)
//   backup        a no-op by default: the shell takes no backup here (see the seam below)
//   register      registerAssistant            (scripts/lib/service/assistant-config.ts), the
//                 `claude mcp remove` launched through the Spawner (Windows `claude.cmd` lookup)
//   arrangement / present                      (scripts/lib/service/assistant-arrangement.ts)

import {
  assistantArrangement,
  assistantConfigPath,
  assistantPresent,
} from "../service/assistant-arrangement.ts";
import type { Arrangement } from "../service/assistant-arrangement.ts";
import { registerAssistant } from "../service/assistant-config.ts";
import { selectBackend } from "../service/backend.ts";
import { installMcpDaemon } from "../service/daemon-install.ts";
import { probeAccepts } from "../service/daemon-replace.ts";
import type { InstallResult } from "../service/install.ts";
import { readOrCreateToken } from "../service/token.ts";
import type { Cli, InstallCtx, Spawner } from "./context.ts";

/** The part of the setup context the daemon contract uses. */
export type EnsureHttpCtx = Pick<InstallCtx, "io" | "env" | "platform" | "home" | "repoDir">;

/** The daemon contract's return codes (the shell's `ensure_mempalace_http` status). */
export type EnsureRc = 0 | 1 | 2;

/** Every seam of the flow; each member may throw, the flow turns a throw into the failure arm. */
export interface EnsureHttpDeps {
  /** The bearer token, created when absent; throws when it can neither read nor create one. */
  readonly readToken: () => string;
  /** Does `POST http://host:port/mcp` answer an authenticated `tools/list` with a 2xx status? */
  readonly probeAccepts: (host: string, port: string, token: string) => Promise<boolean>;
  /** Install and start the MCP daemon; `lines` are the operator-facing lines, in order. */
  readonly installDaemon: () => Promise<InstallResult>;
  /** Back up the assistant's configuration file, before the registration write. */
  readonly backup: (cli: Cli) => void;
  /** Write the HTTP registration of `cli`; throws on any failure. */
  readonly register: (cli: Cli, token: string) => void;
  /** The arrangement of an assistant (`http`, `stdio`, `none`, `unknown`, `absent`). */
  readonly arrangement: (cli: Cli) => Arrangement;
  /** Is the assistant's own CLI on PATH (`command -v`)? */
  readonly present: (cli: Cli) => boolean;
}

/** The one definition of the daemon endpoint the shell reads: empty values fall to the defaults. */
export function daemonUrl(host: string, port: string): string {
  return `http://${host}:${port}/mcp`;
}

/** The production seams of one run. */
export function defaultEnsureHttpDeps(
  ctx: EnsureHttpCtx,
  spawn: Spawner,
  endpoint: { readonly host: string; readonly port: string },
): EnsureHttpDeps {
  return {
    readToken: () => readOrCreateToken(),
    probeAccepts: (host, port, token) => probeAccepts(host, port, token),
    installDaemon: async () => {
      let backend: Awaited<ReturnType<typeof selectBackend>>;
      try {
        backend = await selectBackend(ctx.platform);
      } catch {
        return {
          ok: false,
          lines: [`  ERROR: unsupported OS '${ctx.platform}' — install the daemon manually.`],
        };
      }
      return installMcpDaemon({
        repoDir: ctx.repoDir,
        home: ctx.home,
        env: ctx.env,
        platform: ctx.platform,
        backend,
      });
    },
    // `ensure_mempalace_http` takes no backup of its own (only the `switch-http` flow does,
    // common.sh:1703): each setup backs the assistant's config up earlier in its own flow
    // (`backup_file ~/.claude.json`, the settings merge, the MCP config overwrite), which is the
    // backup that spec 0256 requirement 25 asks for. A second one here would add a `.bak.*` file the
    // shell never wrote. The seam stays so a flow can still inject one.
    backup: () => undefined,
    register: (cli, token) =>
      registerAssistant(
        cli,
        ctx.home,
        daemonUrl(endpoint.host, endpoint.port),
        token,
        // `claude mcp remove`'s failure is ignored (`|| true`); the Spawner resolves `claude.cmd`.
        () => void spawn(["claude", "mcp", "remove", "--scope", "user", "mempalace"]),
      ),
    arrangement: (cli) => assistantArrangement(cli, ctx.env, ctx.home),
    present: (cli) => assistantPresent(cli, ctx.env, ctx.home),
  };
}
